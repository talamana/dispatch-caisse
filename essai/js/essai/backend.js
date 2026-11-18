// VERSION DE TEST : une vraie base PostgreSQL qui tourne dans le navigateur (PGlite), avec des données fictives.
// Elle imite l'API Supabase (PostgREST) pour que le site fonctionne exactement comme en ligne,
// mais rien ne sort de cet appareil : la vraie base n'est jamais contactée.
const VERSION = "v2-3";   // à changer à chaque mise à jour de la base de test (repart des données d'exemple)
const FICHIERS = ["supabase_local.sql", "schema.sql", "carte.sql", "cuisine.sql", "organismes.sql", "demo.sql"];
const CLE_SUFFIXE = "dispatch_essai_suffixe";

let pret = null;
let options = { chargerSql: null, dataDir: null, PGlite: null, pgcrypto: null };

export function configurer(o) { options = { ...options, ...o }; }

function nomBase() {
  let n = 0;
  try { n = Number(localStorage.getItem(CLE_SUFFIXE) || 0); } catch { /* rien */ }
  return `idb://dispatch-essai-${VERSION}-${n}`;
}

export function demarrer() {
  return (pret ||= (async () => {
    const PGlite = options.PGlite || (await import("../../vendor/pglite/index.js")).PGlite;
    const pgcrypto = options.pgcrypto || (await import("../../vendor/pglite/contrib/pgcrypto.js")).pgcrypto;
    const db = await PGlite.create({ dataDir: options.dataDir ?? nomBase(), extensions: { pgcrypto } });
    const deja = (await db.query("select to_regclass('public.essai_info') is not null as ok")).rows[0].ok;
    if (!deja) {
      const charger = options.chargerSql || (async (f) => (await fetch(new URL(`../../sql/${f}`, import.meta.url))).text());
      for (const f of FICHIERS) {
        try { await db.exec(await charger(f)); }
        catch (e) { throw new Error(`Installation de la base de test (${f}) : ${e.message}`); }
      }
      await db.exec(`create table essai_info (version text, cree_le timestamptz default now());
                     insert into essai_info (version) values ('${VERSION}');`);
    }
    return db;
  })());
}

// Efface les données de test (nouvelle base au prochain chargement)
export function reinitialiser() {
  let n = 0;
  try { n = Number(localStorage.getItem(CLE_SUFFIXE) || 0); localStorage.setItem(CLE_SUFFIXE, String(n + 1)); } catch { /* rien */ }
  try { indexedDB.deleteDatabase(`/pglite/dispatch-essai-${VERSION}-${n}`); } catch { /* rien */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("dispatch")) if (k !== CLE_SUFFIXE) localStorage.removeItem(k); } catch { /* rien */ }
  location.reload();
}

// Exécute du SQL brut (pour simuler « on est lundi », etc.)
export async function sqlDirect(requete, params = []) {
  const db = await demarrer();
  return (await db.query(requete, params)).rows;
}

// --- Imitation de PostgREST -------------------------------------------------------------------------
const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
const ident = (n) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(n)) throw Object.assign(new Error(`Nom invalide : ${n}`), { code: "42602" });
  return `"${n}"`;
};
const valeur = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
const enJson = (corps) => JSON.stringify(corps, (k, v) => (typeof v === "bigint" ? Number(v) : v));

function reponse(code, corps, entetes = {}) {
  const texte = corps === undefined ? "" : enJson(corps);
  return new Response(code === 204 ? null : texte, {
    status: code, headers: { "Content-Type": "application/json", ...entetes },
  });
}

function filtres(params, args) {
  const conditions = [];
  let ordre = null, limite = null, decalage = null;
  for (const [cle, val] of params) {
    if (["select", "columns", "on_conflict"].includes(cle)) continue;
    if (cle === "order") {
      ordre = val.split(",").map((o) => { const [col, ...mods] = o.split("."); return `${ident(col)} ${mods.includes("desc") ? "desc" : "asc"}${mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : ""}`; }).join(", ");
      continue;
    }
    if (cle === "limit") { limite = Number(val); continue; }
    if (cle === "offset") { decalage = Number(val); continue; }
    let [op, ...reste] = val.split(".");
    let v = reste.join(".");
    const negation = op === "not";
    if (negation) { [op, ...reste] = v.split("."); v = reste.join("."); }
    const col = ident(cle);
    let cond;
    if (op === "is") cond = `${col} is ${{ null: "null", true: "true", false: "false" }[v] || "null"}`;
    else if (op === "in") {
      args.push(JSON.stringify(v.replace(/^\(|\)$/g, "").split(",").filter(Boolean).map((x) => x.replace(/^"|"$/g, ""))));
      cond = `${col}::text in (select jsonb_array_elements_text($${args.length}::jsonb))`;
    } else if (OPS[op]) {
      args.push(op.includes("like") ? v.replaceAll("*", "%") : v);
      cond = `${col} ${OPS[op]} $${args.length}`;
    } else throw Object.assign(new Error(`Filtre non géré : ${op}`), { code: "PGRST100" });
    conditions.push(negation ? `not (${cond})` : cond);
  }
  return { where: conditions.length ? ` where ${conditions.join(" and ")}` : "", ordre, limite, decalage };
}

async function table(tx, methode, nom, params, prefer, corps) {
  const t = ident(nom);
  const args = [];
  const { where, ordre, limite, decalage } = filtres(params, args);
  const retour = prefer.includes("return=representation");
  if (methode === "GET" || methode === "HEAD") {
    let q = `select * from ${t}${where}`;
    if (ordre) q += ` order by ${ordre}`;
    if (limite != null) q += ` limit ${Number(limite)}`;
    if (decalage != null) q += ` offset ${Number(decalage)}`;
    return (await tx.query(`select coalesce(json_agg(x), '[]') as r from (${q}) x`, args)).rows[0].r;
  }
  if (methode === "POST") {
    const lignes = Array.isArray(corps) ? corps : [corps];
    const sortie = [];
    const conflit = params.get("on_conflict");
    const resolution = (prefer.match(/resolution=(merge|ignore)-duplicates/) || [])[1];
    for (const ligne of lignes) {
      const cols = Object.keys(ligne);
      const a = cols.map((c) => valeur(ligne[c]));
      let q = `insert into ${t} (${cols.map(ident).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
      if (resolution && conflit) {
        q += ` on conflict (${conflit.split(",").map(ident).join(", ")}) do ${resolution === "ignore" ? "nothing"
          : `update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`}`;
      }
      const r = (await tx.query(`with i as (${q} returning *) select row_to_json(i) as r from i`, a)).rows[0];
      if (r) sortie.push(r.r);
    }
    return retour ? sortie : null;
  }
  if (methode === "PATCH") {
    const cols = Object.keys(corps || {});
    const debut = args.length;
    cols.forEach((c) => args.push(valeur(corps[c])));
    const sets = cols.map((c, i) => `${ident(c)} = $${debut + i + 1}`).join(", ");
    const r = (await tx.query(`with u as (update ${t} set ${sets}${where} returning *) select coalesce(json_agg(u), '[]') as r from u`, args)).rows[0].r;
    return retour ? r : null;
  }
  if (methode === "DELETE") {
    const r = (await tx.query(`with d as (delete from ${t}${where} returning *) select coalesce(json_agg(d), '[]') as r from d`, args)).rows[0].r;
    return retour ? r : null;
  }
  throw Object.assign(new Error(`Méthode non gérée : ${methode}`), { code: "PGRST100" });
}

async function appelRpc(tx, fonction, args) {
  const noms = Object.keys(args || {});
  const q = `select ${ident(fonction)}(${noms.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")}) as r`;
  const r = (await tx.query(q, noms.map((n) => valeur(args[n])))).rows[0].r;
  return r === "" ? null : r;
}

// fetch de remplacement pour supabase-js
export async function fauxFetch(entree, init = {}) {
  const db = await demarrer();
  const url = new URL(typeof entree === "string" ? entree : entree.url);
  const methode = (init.method || "GET").toUpperCase();
  const entetes = {};
  new Headers(init.headers || {}).forEach((v, k) => { entetes[k.toLowerCase()] = v; });
  if (methode === "OPTIONS") return reponse(204);
  const chemin = url.pathname.split("/rest/v1/")[1];
  if (chemin === undefined) return reponse(404, { message: "Seule l'API REST est disponible dans la version de test." });
  const parts = chemin.split("/");
  let corps = null;
  if (init.body) { try { corps = JSON.parse(init.body); } catch { corps = null; } }
  const unSeul = (entetes.accept || "").includes("vnd.pgrst.object");
  let resultat;
  try {
    resultat = await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)",
        [JSON.stringify({ role: "anon" }), JSON.stringify(entetes)]);
      if (parts[0] === "rpc") return { rpc: await appelRpc(tx, parts[1], corps || {}) };
      return { lignes: await table(tx, methode, parts[0], url.searchParams, entetes.prefer || "", corps) };
    });
  } catch (e) {
    const code = e.code || "XX000";
    const corpsErreur = { code, message: e.message, details: e.detail || null, hint: e.hint || null };
    if (code === "P0001" || code === "P0002") return reponse(400, corpsErreur);
    if (code === "42501") return reponse(401, corpsErreur);
    if (code === "23505") return reponse(409, corpsErreur);
    return reponse(400, corpsErreur);
  }
  if ("rpc" in resultat) return reponse(200, resultat.rpc ?? null);
  const lignes = resultat.lignes;
  if (lignes === null) return reponse(methode === "POST" ? 201 : 204);
  if (unSeul) {
    if (lignes.length !== 1) return reponse(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    return reponse(200, lignes[0]);
  }
  return reponse(methode === "POST" ? 201 : 200, lignes, { "Content-Range": `0-${Math.max(lignes.length - 1, 0)}/*` });
}

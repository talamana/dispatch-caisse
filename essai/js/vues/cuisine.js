// Cuisine : ouverte aux employés (comme la caisse).
// - À cuisiner : un grand bloc par plat, toutes commandes confondues (« 6 chocolats chauds »), avec les
//   ingrédients, où aller les chercher (logements) et les recettes à préparer avant (ex. la crêpe).
//   « Cuire » retire les ingrédients du stock et donne les portions aux commandes les plus anciennes.
// - Commandes : tickets courts et colorés, avec l'avancement plat par plat.
// - Recettes : toutes les recettes du jeu, et un calcul pour préparer à l'avance.
import { rpc } from "../api.js";
import { besoins, indexer, lieuDAchat, normIngredient } from "../cuisine_calc.js";
import { $, $$, echapper, fenetre, fmt, messageErreur, toast } from "../outils.js";

const RAFRAICHIR_MS = 8000;
const memoire = {
  lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* rien */ } },
};
const couleur = (id) => `hsl(${(Number(id) * 67) % 360} 70% 55%)`;
const puceCmd = (id, n) => `<span class="puce-cmd" data-cmd="${id}" style="--c:${couleur(id)}" title="Voir seulement cette commande">N°${id}${n > 1 ? ` ×${n}` : ""}</span>`;
const nb = (v) => (Math.round(Number(v || 0) * 100) / 100).toLocaleString("fr-FR");
const heure = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const depuis = (d) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  return min < 1 ? "à l'instant" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
};

export async function afficher(vue, params) {
  const onglet = ["commandes", "livraisons", "recettes"].includes(params[0]) ? params[0] : "cuire";
  vue.innerHTML = `<div class="page large"><div class="titre-page"><h1>Cuisine</h1><span class="discret" id="cuisine-maj"></span>
      <span class="espace"></span><input class="champ" id="cuisinier" placeholder="Qui cuisine ?" style="max-width:180px" value="${echapper(memoire.lire("dispatch_vendeur", ""))}"></div>
    <div class="onglets-page"><button data-onglet="cuire" aria-selected="${onglet === "cuire"}">🍳 À cuisiner</button>
      <button data-onglet="commandes" aria-selected="${onglet === "commandes"}">🧾 Commandes</button>
      <button data-onglet="livraisons" aria-selected="${onglet === "livraisons"}">🚚 Livraisons</button>
      <button data-onglet="recettes" aria-selected="${onglet === "recettes"}">📖 Recettes</button></div>
    <div id="zone-cuisine"><div class="vide">Chargement…</div></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/cuisine/${b.dataset.onglet}`; }));
  $("#cuisinier", vue).addEventListener("change", (e) => memoire.ecrire("dispatch_vendeur", e.target.value.trim()));
  let donnees = await rpc("cuisine");
  if (!vue.isConnected) return;
  const zone = $("#zone-cuisine", vue);
  const ctx = { vue, zone, get donnees() { return donnees; }, idx: indexer(donnees), par: () => $("#cuisinier", vue).value.trim() || null };
  if (onglet === "recettes") return recettes(zone, donnees, ctx.idx);
  const dessiner = onglet === "commandes" ? () => tickets(ctx) : onglet === "livraisons" ? () => livraisons(ctx) : () => aCuisiner(ctx);
  ctx.recharger = async () => { donnees = await rpc("cuisine"); ctx.idx = indexer(donnees); dessiner(); };
  dessiner();
  // Nouvelles commandes : on interroge la base toutes les 8 s
  const connues = new Set(donnees.commandes.map((c) => c.id));
  let enCours = false;
  const rafraichir = async () => {
    if (enCours || document.hidden || !zone.isConnected || zone.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    enCours = true;
    try {
      const d = await rpc("cuisine");
      for (const c of d.commandes) if (!connues.has(c.id)) { connues.add(c.id); toast(`🔔 Nouvelle commande n°${c.id}`); }
      donnees = d; ctx.idx = indexer(d); dessiner();
    } catch { /* réseau : on réessaie au prochain tour */ } finally { enCours = false; }
  };
  const minuteur = setInterval(rafraichir, RAFRAICHIR_MS);
  return () => clearInterval(minuteur);
}

// --- Plan de cuisson : ce qu'il reste à préparer, plat par plat (sous-recettes comprises) ---------------
function plan(d, idx) {
  const p = new Map();
  const ligne = (id) => {
    if (!p.has(id)) p.set(id, { r: idx.recettes.get(id), demande: 0, servir: 0, commandes: [], pour: new Set() });
    return p.get(id);
  };
  for (const c of d.commandes) for (const pl of c.plats || []) {
    if (!pl.recette) continue;
    const reste = pl.qte - pl.faits;
    if (reste <= 0) continue;
    const l = ligne(pl.recette);
    l.demande += reste; l.servir += reste; l.commandes.push({ id: c.id, n: reste });
  }
  const ordre = () => [...p.keys()].sort((a, b) => (idx.niveau.get(a) || 0) - (idx.niveau.get(b) || 0));
  const faits = new Set();
  for (;;) {
    const id = ordre().find((x) => !faits.has(x));
    if (id === undefined) break;
    faits.add(id);
    const l = p.get(id);
    if (!l.r) continue;
    l.reserve = Number(d.reserve?.[id] || 0);
    l.aCuire = Math.max(0, l.demande - l.reserve);
    l.cuissons = Math.ceil(l.aCuire / Math.max(1, l.r.produit));
    for (const i of l.r.ingredients || []) {
      const sous = idx.recettesParNom.get(normIngredient(i.nom));
      if (sous && sous.id !== id && l.cuissons > 0) {
        const s = ligne(sous.id);
        s.demande += (Number(i.qte) || 1) * l.cuissons;
        s.pour.add(l.r.nom);
      }
    }
  }
  return [...p.values()].filter((l) => l.r && (l.demande > 0));
}

// Stock d'un ingrédient par logement, et d'où le prendre (logement habituel d'abord, comme la base)
function ouPrendre(nom, qte, d, idx) {
  const ing = idx.prix.get(normIngredient(nom));
  const vrai = ing?.nom || nom;
  const dispo = (d.stocks || []).filter((s) => s.ingredient === vrai && Number(s.quantite) > 0)
    .sort((a, b) => ((b.logement_id === ing?.logement_id) - (a.logement_id === ing?.logement_id)) || b.quantite - a.quantite);
  const pris = [];
  let reste = qte;
  for (const s of dispo) { if (reste <= 0) break; const n = Math.min(reste, Number(s.quantite)); pris.push({ logement: s.logement_id, qte: n, stock: Number(s.quantite) }); reste -= n; }
  return { nom: vrai, pris, manque: Math.max(0, reste), ing };
}
const nomLogement = (d, id) => { const l = (d.logements || []).find((x) => x.id === id); return l ? `${l.nom}${l.gerant ? ` (chez ${l.gerant})` : ""}` : "?"; };
const courtLogement = (d, id) => (d.logements || []).find((x) => x.id === id)?.nom || "?";

// --- Onglet « À cuisiner » ------------------------------------------------------------------------------------
let filtreCmd = null;   // « À cuisiner » limité à une commande (clic sur son numéro)
function aCuisiner(ctx) {
  const { zone } = ctx, idx = ctx.idx;
  if (filtreCmd && !ctx.donnees.commandes.some((c) => c.id === filtreCmd)) filtreCmd = null;
  const d = filtreCmd ? { ...ctx.donnees, commandes: ctx.donnees.commandes.filter((c) => c.id === filtreCmd) } : ctx.donnees;
  const lignes = plan(d, idx).sort((a, b) => (idx.niveau.get(b.r.id) || 0) - (idx.niveau.get(a.r.id) || 0)
    || Math.min(...a.commandes.map((c) => c.id), Infinity) - Math.min(...b.commandes.map((c) => c.id), Infinity));
  const nbCmd = d.commandes.filter((c) => c.etat !== "prete").length;
  const nbPlats = lignes.reduce((s, l) => s + l.servir, 0);
  const sansRecette = d.commandes.flatMap((c) => (c.plats || []).filter((p) => !p.recette && p.qte > p.faits).map((p) => ({ c, p })));

  // ingrédients pour toutes les cuissons restantes, puis où les prendre
  const besoinIng = new Map();
  for (const l of lignes) for (const i of l.r.ingredients || []) {
    const sous = idx.recettesParNom.get(normIngredient(i.nom));
    if (sous && sous.id !== l.r.id) continue;
    const k = normIngredient(i.nom);
    const e = besoinIng.get(k) || { nom: i.nom, qte: 0, pour: new Set() };
    e.qte += (Number(i.qte) || 1) * l.cuissons; if (l.cuissons) e.pour.add(l.r.nom); besoinIng.set(k, e);
  }
  // ingrédients qu'on fabrique (Beurre, Pâte, Frites…) : ce que le stock ne couvre pas est à fabriquer avant,
  // et ses composants s'ajoutent à la liste (du plus « haut » au plus « bas » : Pâte à pizza avant Pâte)
  const stockTotal = (nom) => (d.stocks || []).filter((x) => x.ingredient === nom).reduce((a, x) => a + Math.max(0, Number(x.quantite)), 0);
  const fabrications = [];
  const vus = new Set();
  for (;;) {
    const k = [...besoinIng.keys()].filter((x) => !vus.has(x) && (idx.prix.get(x)?.composition || []).length)
      .sort((a, b) => idx.niveauI.get(a) - idx.niveauI.get(b))[0];
    if (k === undefined) break;
    vus.add(k);
    const e = besoinIng.get(k), ing = idx.prix.get(k);
    const manque = Math.max(0, e.qte - stockTotal(ing.nom));
    if (!manque) continue;
    const produit = Math.max(1, Number(ing.produit) || 1), fois = Math.ceil(manque / produit);
    fabrications.push({ ing, fois, qte: fois * produit, pour: [...e.pour] });
    e.qte -= manque;                                     // le reste vient du stock
    for (const c of ing.composition) {
      const kc = normIngredient(c.nom);
      const ec = besoinIng.get(kc) || { nom: c.nom, qte: 0, pour: new Set() };
      ec.qte += (Number(c.qte) || 1) * fois; ec.pour.add(ing.nom); besoinIng.set(kc, ec);
    }
  }
  const aFabriquer = new Set(fabrications.map((f) => f.ing.nom));
  const parLogement = new Map(), manques = [];
  for (const e of besoinIng.values()) {
    if (!e.qte) continue;
    const o = ouPrendre(e.nom, e.qte, d, idx);
    for (const x of o.pris) { const g = parLogement.get(x.logement) || []; g.push({ nom: o.nom, qte: x.qte, stock: x.stock }); parLogement.set(x.logement, g); }
    if (o.manque > 0) manques.push({ nom: o.nom, qte: o.manque, ing: o.ing });
  }

  const tuile = (l) => {
    const r = l.r;
    const sousPrets = (r.ingredients || []).map((i) => {
      const sous = idx.recettesParNom.get(normIngredient(i.nom));
      return sous && sous.id !== r.id ? { sous, besoin: (Number(i.qte) || 1), dispo: Number(d.reserve?.[sous.id] || 0) } : null;
    }).filter(Boolean);
    const bloque = sousPrets.find((s) => s.dispo < s.besoin);
    const ingr = (r.ingredients || []).map((i) => {
      const sous = idx.recettesParNom.get(normIngredient(i.nom));
      if (sous && sous.id !== r.id) {
        const dispo = Number(d.reserve?.[sous.id] || 0);
        return `<li class="sous"><b>${i.qte}×</b> ${echapper(sous.nom)} <span class="${dispo >= i.qte ? "vert" : "orange"}">${dispo >= i.qte ? `✓ ${dispo} prête(s)` : "à préparer d'abord ↓"}</span></li>`;
      }
      const o = ouPrendre(i.nom, Number(i.qte) || 1, d, idx);
      const ou = aFabriquer.has(o.nom) ? '<span class="orange">🧪 à fabriquer d\'abord ↓</span>'
        : o.pris.length ? `📍 ${echapper(courtLogement(d, o.pris[0].logement))}` : '<span class="rouge">⚠ pas en stock</span>';
      return `<li><b>${i.qte}×</b> ${echapper(o.nom)} <span class="discret">${ou}</span></li>`;
    }).join("");
    const portionsParCuisson = Math.max(1, r.produit);
    return `<article class="tuile-plat ${l.servir ? "" : "sous-recette"}" data-recette="${echapper(r.id)}">
      <header><div class="compte">${l.servir || l.aCuire}</div><div class="titre-plat"><h3>${echapper(r.nom)}</h3>
        <div class="discret">${l.servir ? "à servir" : `à préparer pour : ${echapper([...l.pour].join(", "))}`}${portionsParCuisson > 1 ? ` · ${portionsParCuisson} portions par cuisson` : ""}</div></div></header>
      ${l.commandes.length ? `<div class="puces">${l.commandes.map((c) => puceCmd(c.id, c.n)).join("")}</div>` : ""}
      ${l.reserve ? `<div class="reserve">🥡 ${l.reserve} déjà prête(s) en réserve${l.servir ? ` <button class="btn petit" data-servir="${echapper(r.id)}">Servir la réserve</button>` : ""}</div>` : ""}
      <ul class="ingr">${ingr}</ul>
      <footer>${l.cuissons > 0
        ? (bloque ? `<div class="bloque">D'abord : préparer <strong>${echapper(bloque.sous.nom)}</strong></div>` : "")
          + `<button class="btn gros principal" data-cuire="${echapper(r.id)}" data-fois="${l.cuissons}" ${bloque ? "disabled" : ""}>🍳 Cuire${l.cuissons > 1 ? ` ×${l.cuissons}` : ""} <span>→ ${l.cuissons * portionsParCuisson} portion${l.cuissons * portionsParCuisson > 1 ? "s" : ""}</span></button>`
          + (l.cuissons > 1 ? `<button class="btn" data-cuire="${echapper(r.id)}" data-fois="1" ${bloque ? "disabled" : ""}>×1</button>` : "")
        : '<div class="vert">✓ La réserve suffit</div>'}</footer></article>`;
  };

  const tuileFab = (f) => `<article class="tuile-plat sous-recette fabrication" data-ingredient="${echapper(f.ing.nom)}">
      <header><div class="compte">${f.qte}</div><div class="titre-plat"><h3 class="sans-lien">🧪 ${echapper(f.ing.nom)}</h3>
        <div class="discret">à fabriquer pour : ${echapper(f.pour.join(", "))}${f.ing.produit > 1 ? ` · ${f.ing.produit} par fabrication` : ""}</div></div></header>
      <ul class="ingr">${f.ing.composition.map((c) => {
        const o = ouPrendre(c.nom, Number(c.qte) || 1, d, idx);
        const ou = aFabriquer.has(o.nom) ? '<span class="orange">🧪 à fabriquer d\'abord</span>'
          : o.pris.length ? `📍 ${echapper(courtLogement(d, o.pris[0].logement))}` : '<span class="rouge">⚠ pas en stock</span>';
        return `<li><b>${c.qte}×</b> ${echapper(o.nom)} <span class="discret">${ou}</span></li>`;
      }).join("")}</ul>
      <footer><button class="btn gros principal" data-fabriquer="${echapper(f.ing.nom)}" data-fois="${f.fois}">🧪 Fabriquer${f.fois > 1 ? ` ×${f.fois}` : ""}</button></footer></article>`;
  // ordre de travail : d'abord les ingrédients à fabriquer (Pâte avant Pâte à pizza), puis les plats
  fabrications.sort((a, b) => idx.niveauI.get(normIngredient(b.ing.nom)) - idx.niveauI.get(normIngredient(a.ing.nom)));

  zone.innerHTML = `<div class="cuisine">
    <section>
      <div class="resume-cuisine"><div><strong>${nbCmd}</strong> commande${nbCmd > 1 ? "s" : ""} en attente</div><div><strong>${nbPlats}</strong> plat${nbPlats > 1 ? "s" : ""} à servir</div>
        <div><strong>${lignes.reduce((s, l) => s + l.cuissons, 0)}</strong> cuisson${lignes.reduce((s, l) => s + l.cuissons, 0) > 1 ? "s" : ""}</div></div>
      ${ctx.donnees.commandes.length > 1 ? `<div class="filtres filtre-cmd"><button class="puce-filtre" data-filtre-cmd="" aria-pressed="${!filtreCmd}">Toutes</button>${ctx.donnees.commandes.map((c) =>
        `<button class="puce-filtre" data-filtre-cmd="${c.id}" aria-pressed="${filtreCmd === c.id}" style="border-color:${couleur(c.id)}">N°${c.id}${c.client ? ` · ${echapper(c.client)}` : ""}</button>`).join("")}</div>` : ""}
      ${lignes.length ? `<div class="tuiles-plats">${fabrications.map(tuileFab).join("")}${lignes.map(tuile).join("")}</div>` : '<div class="vide grand">✅ Rien à cuisiner. Les commandes arrivent ici dès qu\'elles sont passées à la caisse.</div>'}
      ${sansRecette.length ? `<div class="bloc"><h3 class="sous-titre">À donner aussi (pas de recette)</h3><div class="puces">${sansRecette.map(({ c, p }) =>
        `<span class="badge">${p.qte - p.faits}× ${echapper(p.nom)}</span> ${puceCmd(c.id, 1)}`).join(" ")}</div></div>` : ""}
    </section>
    <aside class="bloc besoins">
      <div class="bloc-tete"><h2 class="titre-bloc">🏠 À aller chercher</h2></div>
      ${parLogement.size ? [...parLogement].map(([log, g]) => `<div class="lieu-achat"><div class="lieu-tete"><strong>📍 ${echapper(nomLogement(d, log))}</strong></div>
          <table class="liste compacte"><tbody>${g.map((x) => `<tr><td>${echapper(x.nom)}</td><td class="droite"><strong>${nb(x.qte)}</strong></td><td class="droite discret">sur ${nb(x.stock)}</td></tr>`).join("")}</tbody></table></div>`).join("")
        : lignes.length ? '<p class="discret">Aucun ingrédient en stock dans les logements pour ces plats.</p>' : '<p class="discret">Rien à aller chercher.</p>'}
      ${manques.length ? `<h3 class="sous-titre">⚠ Manque (à acheter)</h3><table class="liste compacte"><tbody>${manques.map((m) => {
          const lieu = lieuDAchat(m.ing);
          return `<tr><td>${echapper(m.nom)}</td><td class="droite"><strong>${nb(m.qte)}</strong></td><td class="discret">${echapper(lieu || "lieu à définir")}</td></tr>`;
        }).join("")}</tbody></table>
` : ""}
      <div class="actions-ligne"><button class="btn" data-copier>📋 Copier la liste</button></div>
    </aside></div>`;
  $("#cuisine-maj", ctx.vue).textContent = `· à jour ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  zone.onclick = async (e) => {
    const f = e.target.closest("[data-filtre-cmd]");
    if (f) { filtreCmd = f.dataset.filtreCmd ? Number(f.dataset.filtreCmd) : null; return aCuisiner(ctx); }
    const pc = e.target.closest(".tuile-plat .puce-cmd");
    if (pc) { filtreCmd = Number(pc.dataset.cmd); return aCuisiner(ctx); }
    const titre = e.target.closest(".titre-plat h3:not(.sans-lien)");
    if (titre) { const r = idx.recettes.get(titre.closest("[data-recette]").dataset.recette); if (r) detailRecette(r, idx); return; }
    const b = e.target.closest("[data-cuire],[data-servir],[data-fabriquer],[data-copier]");
    if (!b || b.disabled) return;
    if (b.dataset.copier !== undefined) {
      const texte = "À aller chercher :\n" + [...parLogement].map(([log, g]) => `${nomLogement(d, log)} : ${g.map((x) => `${nb(x.qte)} ${x.nom}`).join(", ")}`).join("\n")
        + (fabrications.length ? `\nÀ fabriquer : ${fabrications.map((f) => `${f.qte} ${f.ing.nom}`).join(", ")}` : "")
        + (manques.length ? `\nÀ acheter : ${manques.map((m) => `${nb(m.qte)} ${m.nom}`).join(", ")}` : "");
      try { await navigator.clipboard.writeText(texte); toast("Liste copiée."); } catch { toast(texte); }
      return;
    }
    b.disabled = true;
    try {
      if (b.dataset.cuire) {
        const r = await rpc("cuisiner", { p_recette: b.dataset.cuire, p_fois: Number(b.dataset.fois), p_par: ctx.par() });
        const nomR = idx.recettes.get(b.dataset.cuire)?.nom || "";
        toast(`🍳 ${r.portions} ${nomR}${r.donnees.length ? ` → ${r.donnees.map((x) => `N°${x.vente}${x.n > 1 ? ` ×${x.n}` : ""}`).join(", ")}` : ""}${r.reserve ? ` · ${r.reserve} en réserve` : ""}`);
      } else if (b.dataset.servir) {
        const r = await rpc("servir_reserve", { p_recette: b.dataset.servir });
        toast(r.length ? `Réserve servie : ${r.map((x) => `N°${x.vente} ×${x.n}`).join(", ")}` : "Aucune commande n'en attend.");
      } else if (b.dataset.fabriquer) {
        const r = await rpc("fabriquer", { p_ingredient: b.dataset.fabriquer, p_fois: Number(b.dataset.fois), p_par: ctx.par() });
        toast(`🧪 ${r.qte} ${b.dataset.fabriquer} fabriqué(s).`);
      }
      await ctx.recharger();
    } catch (err) { toast(messageErreur(err), true); b.disabled = false; }
  };
}

// --- Onglet « Commandes » : tickets courts et colorés --------------------------------------------------------
function tickets(ctx) {
  const { zone } = ctx, d = ctx.donnees;
  const ETATS = { a_faire: ["À faire", ""], en_cours: ["En cours", "orange"], prete: ["Prête ✓", "vert"] };
  zone.innerHTML = d.commandes.length ? `<div class="tickets">${d.commandes.map((c) => {
    const plats = c.plats || [];
    const total = plats.reduce((s, p) => s + p.qte, 0), faits = plats.reduce((s, p) => s + Math.min(p.faits, p.qte), 0);
    const [lib, coul] = ETATS[c.etat] || [c.etat, ""];
    return `<article class="ticket-cuisine ${c.etat}" style="--c:${couleur(c.id)}" data-id="${c.id}">
      <header><span class="num">N°${c.id}</span><span class="discret">${heure(c.date)} · ${depuis(c.date)}</span><span class="espace"></span><span class="badge ${coul}">${lib}</span></header>
      ${c.client || c.vendeur ? `<div class="discret qui">${echapper([c.client, c.mode === "semaine" ? "📅" : c.mode === "facture" ? "🧾" : "", c.vendeur && `caisse : ${c.vendeur}`].filter(Boolean).join(" · "))}</div>` : ""}
      <div class="progression"><div style="width:${total ? (faits / total) * 100 : 0}%"></div></div>
      <div class="plats-ticket">${plats.map((p) => `<button class="plat-ticket ${p.faits >= p.qte ? "fait" : ""}" data-cle="${echapper(p.cle)}" title="Toucher : un de plus prêt (appui long ou clic droit : un de moins)">
        <span class="n">${p.faits >= p.qte ? "✓" : `${p.faits}/${p.qte}`}</span>${echapper(p.nom)}</button>`).join("")}</div>
      <footer>${c.etat !== "prete" ? '<button class="btn petit vert" data-etat="prete">Tout est prêt</button>' : ""}
        <button class="btn petit" data-livrer title="Livrée au client : passe dans le résumé">Livrée ✓</button></footer></article>`;
  }).join("")}</div>` : '<div class="vide grand">✅ Aucune commande en attente.</div>';

  const changer = async (c, etat, faits) => {
    try { await rpc("cuisine_etat", { p_id: c.id, p_etat: etat, p_faits: faits }); await ctx.recharger(); }
    catch (err) { toast(messageErreur(err), true); }
  };
  const objetFaits = (c) => Object.fromEntries((c.plats || []).map((p) => [p.cle, p.faits]));
  zone.onclick = (e) => {
    const t = e.target.closest(".ticket-cuisine"); if (!t) return;
    const c = d.commandes.find((x) => x.id === Number(t.dataset.id)); if (!c) return;
    const plat = e.target.closest("[data-cle]");
    if (plat) {
      const p = c.plats.find((x) => x.cle === plat.dataset.cle);
      const f = objetFaits(c); f[p.cle] = p.faits >= p.qte ? 0 : p.faits + 1;
      return changer(c, null, f);
    }
    if (e.target.closest("[data-livrer]")) return livrer(ctx, c);
    const b = e.target.closest("[data-etat]");
    if (b) {
      if (b.dataset.etat === "prete") return changer(c, "prete", Object.fromEntries(c.plats.map((p) => [p.cle, p.qte])));
      return changer(c, b.dataset.etat, null);
    }
  };
  zone.oncontextmenu = (e) => {
    const plat = e.target.closest("[data-cle]"); if (!plat) return;
    e.preventDefault();
    const c = d.commandes.find((x) => x.id === Number(plat.closest(".ticket-cuisine").dataset.id));
    const p = c.plats.find((x) => x.cle === plat.dataset.cle);
    const f = objetFaits(c); f[p.cle] = Math.max(0, p.faits - 1);
    changer(c, null, f);
  };
}

// --- Livraisons : on cuisine chez nous puis on livre ; le résumé garde la trace --------------------------
const MODES = {
  comptant: (c) => `💵 payé à la caisse (${fmt(c.total)})`,
  semaine: (c) => `📅 sur la facture du lundi${c.payeur ? ` → ${c.payeur}` : ""} (${fmt(c.total)})`,
  facture: (c) => `🧾 facture ${c.facture || ""} à payer (${fmt(c.total)})`,
};
const contenu = (c) => (c.lignes || []).map((l) => `${l.qte}× ${l.nom}`);
function texteBon(c, par) {
  return [`🚚 Bon de livraison — Le Dispatch`, `Commande n°${c.id} du ${new Date(c.date).toLocaleDateString("fr-FR")} à ${heure(c.date)}`,
    `Client : ${c.client || "De passage"}`, ...contenu(c).map((x) => `- ${x}`), `Paiement : ${(MODES[c.mode] || MODES.comptant)(c).replace(/^\S+\s/, "")}`,
    par || c.livre_par ? `Livré par : ${par || c.livre_par}` : null].filter(Boolean).join("\n").replace(/\u202f|\u00a0/g, " ");
}
async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); toast("Copié : colle-le où tu veux (Discord, notes…)."); }
  catch { await fenetre({ titre: "À copier", contenu: `<textarea class="champ" rows="12" readonly>${echapper(texte)}</textarea>`, boutons: [{ texte: "Fermer" }] }); }
}
async function livrer(ctx, c) {
  const pret = (c.plats || []).every((p) => !p.recette || p.faits >= p.qte);
  const par = ctx.par();
  if (!pret && !(await fenetre({ titre: `Livrer la commande n°${c.id} ?`, contenu: "<p>Tous les plats ne sont pas marqués prêts. La livrer quand même ?</p>",
    boutons: [{ texte: "Retour" }, { texte: "Livrée quand même", classe: "principal", valeur: true }] }))) return;
  try { await rpc("livrer", { p_id: c.id, p_par: par }); toast(`🚚 Commande n°${c.id} livrée${c.client ? ` à ${c.client}` : ""}.`); await ctx.recharger(); }
  catch (err) { toast(messageErreur(err), true); }
}

let joursResume = 1;
async function livraisons(ctx) {
  const { zone } = ctx, d = ctx.donnees;
  const resume = await rpc("cuisine_resume", { p_jours: joursResume });
  if (!zone.isConnected) return;
  // clé = date locale (tri), libellé = « mercredi 18 novembre »
  const jour = (x) => { const t = new Date(x); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const libelleJour = (k) => new Date(k + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const parJour = new Map();
  for (const l of resume.livrees) { const k = jour(l.livree_le || l.date); if (!parJour.has(k)) parJour.set(k, []); parJour.get(k).push(l); }
  const cuissonsJour = new Map();
  for (const j of resume.cuissons) {
    const k = jour(j.date);
    if (!cuissonsJour.has(k)) cuissonsJour.set(k, new Map());
    const m = cuissonsJour.get(k), e = m.get(j.nom) || { portions: 0, par: new Set() };
    e.portions += j.portions; if (j.par) e.par.add(j.par); m.set(j.nom, e);
  }
  const jours = [...new Set([...parJour.keys(), ...cuissonsJour.keys()])].sort().reverse();
  const aLivrer = [...d.commandes].sort((a, b) => (b.etat === "prete") - (a.etat === "prete") || a.id - b.id);
  zone.innerHTML = `<div class="grille-livraison">
    <section><h2 class="titre-section">🚚 À livrer</h2>
      ${aLivrer.length ? `<div class="bons-livraison">${aLivrer.map((c) => {
        const plats = c.plats || [], tot = plats.reduce((s2, p) => s2 + p.qte, 0), faits = plats.reduce((s2, p) => s2 + Math.min(p.faits, p.qte), 0);
        return `<article class="bon-livraison ${c.etat}" style="--c:${couleur(c.id)}" data-id="${c.id}">
          <header><span class="num">N°${c.id}</span><strong class="client">${echapper(c.client || "De passage")}</strong><span class="espace"></span>
            ${c.etat === "prete" ? '<span class="badge vert">prête à livrer</span>' : `<span class="badge orange">en cuisine ${faits}/${tot}</span>`}</header>
          <div class="discret">${heure(c.date)} · il y a ${depuis(c.date)}${c.vendeur ? ` · caisse : ${echapper(c.vendeur)}` : ""}</div>
          <ul class="contenu-livraison">${contenu(c).map((x) => `<li>${echapper(x)}</li>`).join("")}</ul>
          <div class="paiement">${echapper((MODES[c.mode] || MODES.comptant)(c))}</div>
          <footer><button class="btn petit" data-bon>📋 Bon de livraison</button><button class="btn petit ${c.etat === "prete" ? "vert" : ""}" data-livrer>✓ Livrée</button></footer></article>`;
      }).join("")}</div>` : '<div class="vide">Rien à livrer pour l\'instant.</div>'}
    </section>
    <section class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📜 Résumé</h2><span class="espace"></span>
        <select class="champ" id="jours-resume" style="max-width:170px">${[[1, "Aujourd'hui"], [3, "3 derniers jours"], [7, "7 derniers jours"], [31, "31 derniers jours"]]
          .map(([v, t]) => `<option value="${v}" ${v === joursResume ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      ${jours.length ? jours.map((k) => {
        const liv = parJour.get(k) || [], cui = cuissonsJour.get(k) || new Map();
        return `<div class="jour-resume"><div class="lieu-tete"><strong>${echapper(libelleJour(k))}</strong><span class="espace"></span>
            ${liv.length} livraison${liv.length > 1 ? "s" : ""} · ${fmt(liv.reduce((s2, l) => s2 + l.total, 0))}
            <button class="btn petit" data-copier-jour="${echapper(k)}">📋</button></div>
          ${liv.length ? `<table class="liste compacte"><tbody>${liv.map((l) => `<tr><td class="nowrap">${heure(l.livree_le || l.date)}</td>
            <td><span class="puce-cmd" style="--c:${couleur(l.id)}">N°${l.id}</span></td>
            <td><strong>${echapper(l.client || "De passage")}</strong><div class="discret">${echapper(contenu(l).join(", "))}</div></td>
            <td class="discret">${echapper((MODES[l.mode] || MODES.comptant)(l).split(" (")[0])}${l.livre_par ? `<div>🚚 ${echapper(l.livre_par)}</div>` : ""}</td>
            <td class="droite nowrap"><strong>${fmt(l.total)}</strong></td></tr>`).join("")}</tbody></table>` : ""}
          ${cui.size ? `<div class="discret cuissons-jour">🍳 Cuisiné : ${[...cui].map(([n, e]) => `${e.portions} ${echapper(n)}${e.par.size ? ` (${echapper([...e.par].join(", "))})` : ""}`).join(" · ")}</div>` : ""}</div>`;
      }).join("") : '<div class="vide">Aucune livraison ni cuisson sur cette période.</div>'}
    </section></div>`;
  $("#cuisine-maj", ctx.vue).textContent = `· à jour ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  $("#jours-resume", zone).onchange = (e) => { joursResume = Number(e.target.value); livraisons(ctx); };
  zone.onclick = (e) => {
    const cj = e.target.closest("[data-copier-jour]");
    if (cj) {
      const k = cj.dataset.copierJour, liv = parJour.get(k) || [], cui = cuissonsJour.get(k) || new Map();
      return copier([`📜 Le Dispatch — ${libelleJour(k)}`, `${liv.length} livraison(s) · ${fmt(liv.reduce((s2, l) => s2 + l.total, 0))}`,
        ...liv.map((l) => `- ${heure(l.livree_le || l.date)} N°${l.id} ${l.client || "De passage"} : ${contenu(l).join(", ")} — ${fmt(l.total)}${l.livre_par ? ` (livré par ${l.livre_par})` : ""}`),
        cui.size ? `Cuisiné : ${[...cui].map(([n, x]) => `${x.portions} ${n}`).join(", ")}` : ""].filter(Boolean).join("\n").replace(/\u202f|\u00a0/g, " "));
    }
    const carte = e.target.closest(".bon-livraison"); if (!carte) return;
    const c = d.commandes.find((x) => x.id === Number(carte.dataset.id)); if (!c) return;
    if (e.target.closest("[data-bon]")) return copier(texteBon(c, ctx.par()));
    if (e.target.closest("[data-livrer]")) return livrer(ctx, c);
  };
}

function detailRecette(r, idx) {
  const lignes = (r.ingredients || []).map((i) => {
    const sous = idx.recettesParNom.get(normIngredient(i.nom));
    return `<li><strong>${i.qte}×</strong> ${echapper(i.nom)}${sous && sous.id !== r.id ? ` <span class="badge">à cuisiner avant : ${echapper((sous.ingredients || []).map((x) => x.nom).join(", "))}</span>` : ""}</li>`;
  }).join("");
  return fenetre({ titre: r.nom, contenu: `<p class="discret">Une cuisson donne ${r.produit} portion${r.produit > 1 ? "s" : ""}.</p><ul class="liste-ingredients">${lignes}</ul>`,
    boutons: [{ texte: "Fermer", classe: "principal" }] });
}

const ICONES = { "Maraîcher": "🥕", "Raven": "📞", "Sunny": "📞", "Raven / Sunny": "📞", "Supérette": "🛒" };
const nomLieu = (l) => (l ? `${ICONES[l] || "📍"} ${l}` : "❓ Lieu à définir");

function htmlBesoins(b, titreVide) {
  if (!b.cuissons.length) return `<div class="vide">${echapper(titreVide)}</div>`;
  const prixConnus = b.ingredients.some((i) => i.prix != null);
  const sousTotal = (g) => g.total || !g.sansPrix ? fmt(g.total) + (g.sansPrix ? ` <span class="discret">+ ${g.sansPrix} sans prix</span>` : "") : "";
  const economie = b.cout.toutSuperette - b.cout.total;
  return `<h3 class="sous-titre">Cuissons à lancer</h3>
    <table class="liste compacte"><thead><tr><th>Recette</th><th class="droite">Portions</th><th class="droite">Cuissons</th></tr></thead><tbody>
    ${b.cuissons.map((c) => `<tr><td>${echapper(c.nom)}${c.produit > 1 ? `<div class="discret">${c.produit} portions par cuisson${c.en_trop ? ` · ${c.en_trop} en trop` : ""}</div>` : ""}</td>
      <td class="droite">${c.portions}</td><td class="droite"><strong>${c.cuissons}</strong></td></tr>`).join("")}</tbody></table>
    ${b.preparations.length ? `<h3 class="sous-titre">À préparer avant (ingrédients combinés)</h3>
    <ul class="preparations">${b.preparations.map((p) => `<li><strong>${p.fois}× ${echapper(p.nom)}</strong>
      ${p.produit > 1 ? `<span class="discret">(${p.produit} par fabrication, ${p.qte} nécessaires${p.en_trop ? `, ${p.en_trop} en trop` : ""})</span>` : ""}
      <div class="discret">avec ${p.composants.map((c) => `${c.qte} ${echapper(c.nom)}`).join(", ")}</div></li>`).join("")}</ul>` : ""}
    <h3 class="sous-titre">À acheter</h3>
    ${b.achats.map((g) => `<div class="lieu-achat"><div class="lieu-tete"><strong>${nomLieu(g.lieu)}</strong><span class="espace"></span>${sousTotal(g)}</div>
      <table class="liste compacte"><tbody>${g.articles.map((a) => `<tr><td>${echapper(a.nom)}</td><td class="droite"><strong>${a.qte}</strong></td>
        ${prixConnus ? `<td class="droite discret">${a.prix != null ? `${fmt(a.prix)} /u` : "—"}</td><td class="droite">${a.cout != null ? fmt(a.cout) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>`).join("")}
    ${prixConnus ? `<div class="total-courses"><span>Total</span><strong>${fmt(b.cout.total)}</strong>${b.cout.sansPrix ? `<span class="discret">+ ${b.cout.sansPrix} sans prix</span>` : ""}</div>
      ${economie > 0 && !b.cout.sansPrixSuperette ? `<p class="discret">Tout à la supérette : ${fmt(b.cout.toutSuperette)} — économie ${fmt(economie)}.</p>` : ""}`
    : '<p class="discret">Les prix et le lieu d\'achat (supérette, maraîcher, Raven, Sunny) se règlent dans l\'espace gérant › Carte & réglages › Ingrédients.</p>'}
    <div class="actions-ligne"><button class="btn" data-copier>📋 Copier la liste de courses</button></div>`;
}

function texteCourses(b, titre) {
  const lignes = [titre];
  for (const g of b.achats) {
    lignes.push("", `${g.lieu || "Lieu à définir"}${g.total ? ` (${fmt(g.total)})` : ""} :`);
    for (const a of g.articles) lignes.push(`- ${a.qte} × ${a.nom}`);
  }
  if (b.preparations.length) {
    lignes.push("", "À préparer avant :");
    for (const p of b.preparations) lignes.push(`- ${p.fois} × ${p.nom} (avec ${p.composants.map((c) => `${c.qte} ${c.nom}`).join(", ")})`);
  }
  lignes.push("", "Cuissons :");
  for (const c of b.cuissons) lignes.push(`- ${c.cuissons} × ${c.nom}${c.produit > 1 ? ` (${c.portions} portions)` : ""}`);
  if (b.cout.total) lignes.push("", `Total : ${fmt(b.cout.total)}${b.cout.sansPrix ? ` + ${b.cout.sansPrix} sans prix` : ""}`);
  return lignes.join("\n").replace(/\u202f|\u00a0/g, " ");
}

function brancherCopie(conteneur, texte) {
  const b = $("[data-copier]", conteneur);
  if (!b) return;
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(texte()); toast("Liste copiée : colle-la où tu veux (Discord, notes…)."); }
    catch { await fenetre({ titre: "Liste de courses", contenu: `<textarea class="champ" rows="14" readonly>${echapper(texte())}</textarea>`, boutons: [{ texte: "Fermer" }] }); }
  };
}

// --- Onglet Recettes -------------------------------------------------------------------------------
function recettes(zone, donnees, idx) {
  const choix = new Map(memoire.lire("cuisine_preparation", []));
  let recherche = "";
  zone.innerHTML = `<div class="cuisine">
    <section><input class="champ" id="recherche" placeholder="Chercher une recette ou un ingrédient (ex. crêpe, fraise)…" autocomplete="off">
      <div class="grille-recettes" id="grille"></div></section>
    <aside class="bloc besoins" id="besoins"></aside></div>`;
  const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const dessinerBesoins = () => {
    const b = besoins(new Map([...choix].filter(([, n]) => n > 0)), idx);
    const total = [...choix.values()].reduce((s, n) => s + n, 0);
    $("#besoins", zone).innerHTML = `<div class="bloc-tete"><h2 class="titre-bloc">🧺 Préparation</h2><span class="espace"></span>
      ${total ? '<button class="btn petit" id="vider">Vider</button>' : ""}</div>
      <p class="discret">${total ? `${total} portion${total > 1 ? "s" : ""} choisie${total > 1 ? "s" : ""}.` : "Ajoute des plats avec + pour calculer les ingrédients (préparer du stock, une grosse commande…)."}</p>
      ${htmlBesoins(b, "Rien de choisi.")}`;
    const v = $("#vider", zone); if (v) v.onclick = () => { choix.clear(); sauver(); dessinerGrille(); dessinerBesoins(); };
    brancherCopie($("#besoins", zone), () => texteCourses(b, "Courses — préparation :"));
  };
  const sauver = () => memoire.ecrire("cuisine_preparation", [...choix]);
  const dessinerGrille = () => {
    const q = norm(recherche.trim());
    const liste = donnees.recettes.filter((r) => !q || norm(r.nom).includes(q) || r.ingredients.some((i) => norm(i.nom).includes(q)));
    $("#grille", zone).innerHTML = liste.length ? liste.map((r) => {
      const n = choix.get(r.id) || 0;
      return `<article class="recette ${n ? "choisie" : ""}" data-id="${echapper(r.id)}">
        <header><strong>${echapper(r.nom)}</strong>${r.produit > 1 ? `<span class="badge">×${r.produit} par cuisson</span>` : ""}</header>
        <ul>${r.ingredients.map((i) => {
          const sous = idx.recettesParNom.get(normIngredient(i.nom));
          return `<li>${i.qte > 1 ? `<b>${i.qte}×</b> ` : ""}${echapper(i.nom)}${sous && sous.id !== r.id
            ? ` <span class="sous-recette-info">🍳 à cuisiner avant : ${echapper(sous.ingredients.map((x) => x.nom).join(", "))}</span>` : ""}</li>`;
        }).join("")}</ul>
        <div class="stepper"><button data-pas="-1" ${n ? "" : "disabled"} aria-label="Moins">−</button><span>${n}</span><button data-pas="1" aria-label="Plus">+</button></div></article>`;
    }).join("") : '<div class="vide">Aucune recette ne correspond.</div>';
  };
  $("#recherche", zone).addEventListener("input", (e) => { recherche = e.target.value; dessinerGrille(); });
  zone.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pas]"); if (!b) return;
    const id = b.closest(".recette").dataset.id;
    choix.set(id, Math.max(0, (choix.get(id) || 0) + Number(b.dataset.pas)));
    if (!choix.get(id)) choix.delete(id);
    sauver(); dessinerGrille(); dessinerBesoins();
  });
  dessinerGrille(); dessinerBesoins();
}

// Accès à la base Supabase.
// Pas de compte utilisateur : le code gérant est échangé contre un jeton de session,
// envoyé avec chaque requête dans l'en-tête « x-gerant » (la base ne montre rien sans lui).
const CFG = window.DISPATCH;
const CLE_JETON = "dispatch-jeton-gerant";
let jeton = null;
try { jeton = localStorage.getItem(CLE_JETON); } catch { /* stockage indisponible */ }
function memoriser(j) {
  jeton = j || null;
  try { j ? localStorage.setItem(CLE_JETON, j) : localStorage.removeItem(CLE_JETON); } catch { /* rien */ }
}
export const sb = window.supabase.createClient(CFG.url, CFG.cle, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (url, options = {}) => {
      const entetes = new Headers(options.headers || {});
      if (jeton) entetes.set("x-gerant", jeton);
      return fetch(url, { ...options, headers: entetes });
    },
  },
});

// Exécute une requête Supabase et lève une erreur lisible si elle échoue
export async function q(requete) {
  const { data, error } = await requete;
  if (error) throw error;
  return data;
}
export const rpc = (fonction, args = {}) => q(sb.rpc(fonction, args));
export const table = (nom) => sb.from(nom);

// { code_defini, gerant } — vérifié auprès de la base (jeton expiré, code changé ailleurs…)
let etat = null, etatLe = 0;
export async function etatAcces(forcer = false) {
  if (!forcer && etat && Date.now() - etatLe < 60_000) return etat;
  etat = await rpc("etat_acces");
  etatLe = Date.now();
  if (!etat.gerant && jeton) memoriser(null);
  return etat;
}
export async function sessionActive(verifier = false) {
  try { return (await etatAcces(verifier)).gerant; }
  catch { return !!jeton; }   // base injoignable : on garde l'état local
}
export async function connecter(code) {
  memoriser(await rpc("connexion", { p_code: code }));
  etat = { code_defini: true, gerant: true }; etatLe = Date.now();
}
// Premier code (aucun n'existe encore) ou changement de code par un gérant connecté
export async function definirCode(code) {
  memoriser(await rpc("definir_code", { p_code: code }));
  etat = { code_defini: true, gerant: true }; etatLe = Date.now();
}
export async function deconnecter() {
  try { await rpc("deconnexion"); } catch { /* on oublie le jeton quoi qu'il arrive */ }
  memoriser(null);
  etat = null;
}

// Petit cache des clients (beaucoup de pages affichent des noms de clients)
let cacheClients = null;
export async function clients(recharger = false) {
  if (!cacheClients || recharger) cacheClients = await q(table("clients").select("*").order("nom"));
  return cacheClients;
}
export const oublierClients = () => { cacheClients = null; };
export async function nomsClients() {
  return Object.fromEntries((await clients()).map((c) => [c.id, c.nom]));
}

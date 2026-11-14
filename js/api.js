// Accès à la base Supabase.
const CFG = window.DISPATCH;
export const sb = window.supabase.createClient(CFG.url, CFG.cle, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "dispatch-session" },
});

// Exécute une requête Supabase et lève une erreur lisible si elle échoue
export async function q(requete) {
  const { data, error } = await requete;
  if (error) throw error;
  return data;
}
export const rpc = (fonction, args = {}) => q(sb.rpc(fonction, args));
export const table = (nom) => sb.from(nom);

export async function sessionActive() {
  const { data } = await sb.auth.getSession();
  return data.session;
}
export async function connecter(code) {
  const { error } = await sb.auth.signInWithPassword({ email: CFG.emailGerant, password: code });
  if (error) throw new Error(/invalid/i.test(error.message) ? "Code gérant incorrect." : error.message);
}
export async function deconnecter() {
  await sb.auth.signOut();
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

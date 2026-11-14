// Routeur du site : #/caisse (libre) et l'espace gérant (code).
import { connecter, deconnecter, sb, sessionActive } from "./api.js";
import { $, echapper, messageErreur, toast } from "./outils.js";

const PAGES = [
  { id: "caisse", titre: "Caisse", libre: true, module: () => import("./vues/caisse.js") },
  { id: "tableau", titre: "Tableau de bord", module: () => import("./vues/tableau.js") },
  { id: "compta", titre: "Compta", module: () => import("./vues/compta.js") },
  { id: "factures", titre: "Devis & factures", module: () => import("./vues/documents.js") },
  { id: "clients", titre: "Clients", module: () => import("./vues/clients.js") },
  { id: "interim", titre: "Intérim", module: () => import("./vues/interim.js") },
  { id: "organisation", titre: "Tâches & agenda", module: () => import("./vues/organisation.js") },
  { id: "carte", titre: "Carte & réglages", module: () => import("./vues/carte.js") },
];

let session = null;
let nettoyage = null;
let rendu = 0;  // chaque affichage a son numéro : un affichage dépassé n'écrit plus rien

function route() {
  const [id, ...reste] = (location.hash.replace(/^#\/?/, "") || "caisse").split("/");
  return { id, params: reste.map(decodeURIComponent) };
}

function dessinerEntete() {
  const { id } = route();
  const visibles = session ? PAGES : PAGES.filter((p) => p.libre);
  $("#nav").innerHTML = visibles.map((p) =>
    `<a href="#/${p.id}" ${p.id === id ? 'aria-current="page"' : ""}>${echapper(p.titre)}</a>`).join("")
    + (session ? "" : `<a href="#/tableau" ${id !== "caisse" ? 'aria-current="page"' : ""}>Espace gérant</a>`);
  const compte = $("#puce-compte");
  compte.innerHTML = session ? "🔓 Gérant · Déconnexion" : "🔒 Gérant";
  compte.title = session ? "Se déconnecter de l'espace gérant" : "Ouvrir l'espace gérant";
}

function pageConnexion(vue, cible) {
  vue.innerHTML = `<div class="ecran-centre"><div class="fenetre">
    <h3>Espace gérant</h3>
    <p class="discret">Compta, factures, clients, intérim, tâches… Entre le code gérant.</p>
    <form class="form" id="form-code"><label class="plein">Code gérant
      <input type="password" name="code" autocomplete="current-password" required autofocus></label></form>
    <div class="actions"><a class="btn" href="#/caisse">Retour à la caisse</a><button class="btn principal" id="btn-code" type="button">Entrer</button></div>
  </div></div>`;
  const valider = async () => {
    const code = $("#form-code").elements.code.value;
    if (!code) return;
    $("#btn-code").disabled = true;
    try { await connecter(code); toast("Bienvenue dans l'espace gérant."); afficher(cible); }
    catch (err) { toast(messageErreur(err), true); $("#form-code").elements.code.select(); }
    finally { $("#btn-code") && ($("#btn-code").disabled = false); }
  };
  $("#btn-code").addEventListener("click", valider);
  $("#form-code").addEventListener("submit", (e) => { e.preventDefault(); valider(); });
  setTimeout(() => $("#form-code input")?.focus(), 30);
}

async function afficher() {
  const jeton = ++rendu;
  const { id, params } = route();
  session = await sessionActive();
  if (jeton !== rendu) return;
  dessinerEntete();
  if (typeof nettoyage === "function") { try { nettoyage(); } catch { /* rien */ } }
  nettoyage = null;
  // Nouveau conteneur à chaque page : une page encore en chargement écrit dans l'ancien, détaché
  const vue = document.createElement("div");
  $("#vue").replaceChildren(vue);
  if (id === "imprimer") {
    if (!session) return pageConnexion(vue);
    const m = await import("./vues/imprimer.js");
    nettoyage = await m.afficher(vue, params);
    return;
  }
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  if (!page.libre && !session) return pageConnexion(vue);
  document.title = `${page.titre} — Le Dispatch`;
  vue.innerHTML = `<div class="page"><div class="vide">Chargement…</div></div>`;
  try {
    const m = await page.module();
    if (jeton !== rendu) return;
    const fin = await m.afficher(vue, params, { session });
    if (jeton === rendu) nettoyage = fin; else if (typeof fin === "function") fin();
  } catch (err) {
    if (jeton !== rendu) return;  // erreur d'une page déjà quittée : on l'ignore
    console.error(err);
    vue.innerHTML = `<div class="page"><div class="bloc"><h2 class="titre-bloc">Oups</h2><p>${echapper(messageErreur(err))}</p>
      <button class="btn" onclick="location.reload()">Recharger</button></div></div>`;
  }
}

$("#puce-compte").addEventListener("click", async () => {
  if (session) { await deconnecter(); toast("Déconnecté."); location.hash = "#/caisse"; afficher(); }
  else location.hash = "#/tableau";
});
window.addEventListener("hashchange", afficher);
sb.auth.onAuthStateChange((evenement) => {
  if (evenement === "SIGNED_OUT" && route().id !== "caisse") afficher();
});
afficher();

// Caisse : accessible sans code. Les prix sont recalculés par la base (fonction encaisser).
import { rpc } from "../api.js";
import { $, $$, echapper, fenetre, fmt, messageErreur, TYPES_CLIENT, toast } from "../outils.js";

const memoire = {
  lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(cle, val) { try { localStorage.setItem(cle, JSON.stringify(val)); } catch { /* stockage indisponible */ } },
};
const CLE_VENDEUR = "dispatch_vendeur", CLE_FILE = "dispatch_file_v2", CLE_BROUILLON = "dispatch_brouillon_v2", CLE_CARTE = "dispatch_carte";
const estReseau = (err) => /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(err?.message || String(err));

let carte, articles = {}, panier = new Map(), tarif, uniteRabais = "pourcent", minuterie, envoiEnCours = false;

// --- Calcul (identique à la base : arrondi ,5 vers le haut) -----------------------------------------
function calculer() {
  const lignes = [...panier].filter(([id, q]) => articles[id] && q > 0).map(([id, q]) => ({ a: articles[id], q, montant: articles[id].prix * q }));
  const sousTotal = lignes.reduce((s, l) => s + l.montant, 0);
  const t = carte.tarifs.find((x) => x.id === tarif) || carte.tarifs[0] || { id: null, nom: "", pourcentage: 0 };
  const ajustement = Math.round(sousTotal * Number(t.pourcentage || 0) / 100);
  const base = sousTotal + ajustement;
  let valeur = parseFloat(String($("#rabais-valeur").value).replace(",", "."));
  if (!Number.isFinite(valeur) || valeur < 0) valeur = 0;
  if (uniteRabais === "pourcent") valeur = Math.min(valeur, 100);
  let rabais = uniteRabais === "pourcent" ? Math.round(base * valeur / 100) : Math.min(Math.round(valeur * 100), base);
  rabais = Math.max(0, Math.min(rabais, base));
  return { lignes, sousTotal, ajustement, total: base - rabais, tarif: t, rabais, rabaisValeur: rabais ? valeur : 0,
           rabaisUnite: uniteRabais, motif: $("#rabais-motif").value.trim() };
}
const texteTarif = (t) => !Number(t.pourcentage) ? t.nom : `${t.nom} ${t.pourcentage > 0 ? "+" : "−"}${Math.abs(t.pourcentage)} %`;
function texteRabais(c) {
  if (!c.rabais) return "";
  return (c.rabaisUnite === "pourcent" ? `Rabais ${String(c.rabaisValeur).replace(".", ",")} %` : "Rabais") + (c.motif ? ` (${c.motif})` : "");
}

// --- Affichage ---------------------------------------------------------------------------------------
function squelette(vue) {
  vue.innerHTML = `<div class="caisse">
    <section class="carte-caisse"><div class="raccourcis" id="raccourcis"></div><div id="rayons"></div></section>
    <aside class="ticket" id="ticket" aria-label="Commande en cours">
      <div class="ticket-tete"><h2>Commande</h2><div>
        <button class="lien" id="btn-vendeur" type="button" title="Changer de vendeur">👤 Vendeur</button>
        <button class="lien" id="btn-vider" type="button">Vider</button>
        <button class="lien fermer-ticket" id="btn-fermer-ticket" type="button">Fermer ✕</button></div></div>
      <div class="lignes" id="lignes"></div>
      <div class="options">
        <div><div class="etiquette">Tarif</div><div class="segment" id="tarifs"></div></div>
        <div><div class="etiquette">Client</div><div class="duo">
          <select class="champ" id="type-client" aria-label="Type de client">${Object.entries(TYPES_CLIENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <input class="champ" id="nom-client" placeholder="Nom (facultatif)" maxlength="80" autocomplete="off"></div></div>
        <div><div class="etiquette">Rabais</div><div class="rabais">
          <input class="champ" id="rabais-valeur" type="number" inputmode="decimal" min="0" step="any" placeholder="0" aria-label="Montant du rabais">
          <div class="unite" role="group" aria-label="Unité du rabais"><button type="button" data-unite="pourcent">%</button><button type="button" data-unite="montant">$</button></div>
          <input class="champ" id="rabais-motif" placeholder="Motif (facultatif)" maxlength="100" autocomplete="off"></div></div>
      </div>
      <div class="totaux">
        <div class="rang"><span>Sous-total</span><span id="sous-total">0 $</span></div>
        <div class="rang masque" id="rang-ajust"><span id="libelle-ajust"></span><span id="ajustement"></span></div>
        <div class="rang remise masque" id="rang-rabais"><span id="libelle-rabais"></span><span id="rabais"></span></div>
        <div class="total"><span>TOTAL</span><strong id="total">0 $</strong></div>
        <button class="encaisser" id="btn-encaisser" type="button" disabled>Encaisser</button>
      </div>
    </aside>
    <button class="barre-mobile" id="barre-mobile" type="button"><span id="barre-nb">Panier vide</span><strong id="barre-total">0 $</strong></button>
  </div>`;
}

function dessinerCarte() {
  const categories = [];
  for (const a of carte.articles) {
    let cat = categories.find((c) => c.nom === a.categorie);
    if (!cat) categories.push(cat = { nom: a.categorie, articles: [], compact: a.compact });
    cat.articles.push(a);
  }
  $("#raccourcis").innerHTML = categories.map((c, i) =>
    `<button class="raccourci" type="button" data-cible="rayon-${i}">${echapper(c.nom.replace(/\s*!$/, ""))}<span class="nb">${c.articles.length}</span></button>`).join("");
  $("#rayons").innerHTML = categories.map((c, i) => `<section class="rayon" id="rayon-${i}"><h2 class="titre-cat">${echapper(c.nom)}</h2>
    <div class="tuiles${c.compact ? " compactes" : ""}">${c.articles.map((a) => `<button type="button" class="tuile" data-id="${echapper(a.id)}">
      <span class="emoji">${echapper(a.emoji || "🍽️")}</span><span class="nom">${echapper(a.nom)}</span>
      <span class="contenu">${echapper(a.contenu || "")}</span><span class="prix">${fmt(a.prix)}</span><span class="qte-badge masque"></span></button>`).join("")}</div></section>`).join("");
  $$(".raccourci").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.cible).scrollIntoView({ behavior: "smooth", block: "start" })));
  $$(".tuile").forEach((t) => t.addEventListener("click", () => { panier.set(t.dataset.id, Math.min(999, (panier.get(t.dataset.id) || 0) + 1)); dessinerTicket(); }));
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entrees) => entrees.filter((e) => e.isIntersecting).forEach((e) =>
      $$(".raccourci").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cible === e.target.id)))), { rootMargin: "-140px 0px -60% 0px" });
    $$(".rayon").forEach((s) => obs.observe(s));
  }
  $("#tarifs").innerHTML = carte.tarifs.slice(0, 3).map((t) =>
    `<button type="button" data-id="${echapper(t.id)}" title="${echapper(texteTarif(t))}">${echapper(t.court || texteTarif(t))}</button>`).join("");
  $$("#tarifs button").forEach((b) => b.addEventListener("click", () => { tarif = b.dataset.id; dessinerTicket(); }));
}

function fixer(id, q) {
  if (!Number.isFinite(q) || q <= 0) panier.delete(id); else panier.set(id, Math.min(999, Math.floor(q)));
  dessinerTicket();
}

function dessinerTicket() {
  const c = calculer();
  const zone = $("#lignes");
  if (!c.lignes.length) {
    zone.innerHTML = `<div class="vide">Touche un article de la carte pour l'ajouter.<br>Tu peux ensuite taper la quantité exacte.</div>`;
  } else {
    zone.innerHTML = c.lignes.map(({ a, q, montant }) => `<div class="ligne" data-id="${echapper(a.id)}">
      <div class="nom">${echapper(a.emoji || "")} ${echapper(a.nom)}</div><div class="montant">${fmt(montant)}</div>
      <div class="stepper"><button type="button" data-action="moins" aria-label="Retirer un">−</button>
        <input type="number" inputmode="numeric" min="0" max="999" value="${q}" aria-label="Quantité ${echapper(a.nom)}">
        <button type="button" data-action="plus" aria-label="Ajouter un">+</button>
        <button type="button" class="lien retirer" data-action="suppr" aria-label="Retirer ${echapper(a.nom)}">✕</button></div>
      <div class="pu">${fmt(a.prix)} l'unité</div></div>`).join("");
    $$(".ligne", zone).forEach((l) => {
      const id = l.dataset.id, q = panier.get(id), champ = $("input", l);
      $('[data-action="moins"]', l).addEventListener("click", () => fixer(id, q - 1));
      $('[data-action="plus"]', l).addEventListener("click", () => fixer(id, q + 1));
      $('[data-action="suppr"]', l).addEventListener("click", () => fixer(id, 0));
      champ.addEventListener("change", () => fixer(id, parseInt(champ.value, 10)));
      champ.addEventListener("keydown", (e) => { if (e.key === "Enter") champ.blur(); });
      champ.addEventListener("focus", () => champ.select());
    });
  }
  $$(".tuile").forEach((t) => { const q = panier.get(t.dataset.id) || 0, b = $(".qte-badge", t); b.textContent = "×" + q; b.classList.toggle("masque", !q); });
  $$("#tarifs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === c.tarif.id)));
  $$(".unite button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unite === uniteRabais)));
  $("#sous-total").textContent = fmt(c.sousTotal);
  $("#rang-ajust").classList.toggle("masque", !c.ajustement);
  $("#libelle-ajust").textContent = texteTarif(c.tarif);
  $("#ajustement").textContent = (c.ajustement > 0 ? "+" : "") + fmt(c.ajustement);
  $("#rang-rabais").classList.toggle("masque", !c.rabais);
  $("#libelle-rabais").textContent = texteRabais(c);
  $("#rabais").textContent = "−" + fmt(c.rabais);
  $("#total").textContent = fmt(c.total);
  $("#btn-encaisser").disabled = !c.lignes.length;
  $("#btn-encaisser").textContent = c.lignes.length ? `Encaisser ${fmt(c.total)}` : "Encaisser";
  const nb = c.lignes.reduce((s, l) => s + l.q, 0);
  $("#barre-nb").textContent = nb ? `Voir la commande · ${nb} article${nb > 1 ? "s" : ""}` : "Panier vide";
  $("#barre-total").textContent = fmt(c.total);
  memoire.ecrire(CLE_BROUILLON, { panier: [...panier], tarif, type: $("#type-client").value, client: $("#nom-client").value,
    rabais: { unite: uniteRabais, valeur: $("#rabais-valeur").value, motif: $("#rabais-motif").value } });
}

// --- Envoi (avec file d'attente si pas de connexion) -----------------------------------------------------
function afficherEtat() {
  const n = memoire.lire(CLE_FILE, []).length;
  const puce = $("#puce-etat");
  puce.classList.toggle("masque", !n);
  puce.classList.toggle("attente", n > 0);
  $("#texte-etat").textContent = `${n} commande${n > 1 ? "s" : ""} en attente d'envoi`;
}
async function viderFile() {
  if (envoiEnCours) return;
  envoiEnCours = true;
  try {
    let file = memoire.lire(CLE_FILE, []);
    while (file.length) {
      try { await rpc("encaisser", { p: file[0] }); }
      catch (err) {
        if (estReseau(err)) break;  // toujours hors ligne : on garde
        toast(`Commande en attente refusée : ${messageErreur(err)}`, true);  // refus définitif : on l'écarte
      }
      file.shift(); memoire.ecrire(CLE_FILE, file);
    }
  } finally { envoiEnCours = false; afficherEtat(); }
}

function nouvelUid() { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); } }

async function encaisser() {
  const c = calculer();
  if (!c.lignes.length) return;
  const recap = c.lignes.map(({ a, q, montant }) => `<div><span>${q}× ${echapper(a.nom)}</span><span>${fmt(montant)}</span></div>`).join("")
    + (c.ajustement ? `<div><span>${echapper(texteTarif(c.tarif))}</span><span>${(c.ajustement > 0 ? "+" : "") + fmt(c.ajustement)}</span></div>` : "")
    + (c.rabais ? `<div class="vert"><span>${echapper(texteRabais(c))}</span><span>−${fmt(c.rabais)}</span></div>` : "")
    + `<div class="tot"><span>TOTAL</span><span>${fmt(c.total)}</span></div>`
    + `<div class="discret" style="margin-top:6px"><span>Client</span><span>${echapper($("#nom-client").value.trim() || "De passage")} · ${echapper(TYPES_CLIENT[$("#type-client").value])}</span></div>`;
  const ok = await fenetre({ titre: "Encaisser ?", contenu: `<div class="recap">${recap}</div>`,
    boutons: [{ texte: "Retour" }, { texte: `Encaisser ${fmt(c.total)}`, classe: "principal", valeur: true }] });
  if (!ok) return;
  const cmd = {
    uid: nouvelUid(), vendeur: memoire.lire(CLE_VENDEUR, "") || "Site",
    lignes: c.lignes.map(({ a, q }) => ({ id: a.id, nom: a.nom, qte: q })),
    tarif: c.tarif.id, type_client: $("#type-client").value, client: $("#nom-client").value.trim(),
    rabais: c.rabais ? { type: c.rabaisUnite, valeur: c.rabaisValeur, motif: c.motif } : null,
  };
  let resultat = null, gardee = false;
  try { resultat = await rpc("encaisser", { p: cmd }); }
  catch (err) {
    if (!estReseau(err)) { toast(messageErreur(err), true); return; }
    const file = memoire.lire(CLE_FILE, []); file.push(cmd); memoire.ecrire(CLE_FILE, file); gardee = true; afficherEtat();
  }
  panier = new Map(); tarif = carte.tarifs[0]?.id; uniteRabais = "pourcent";
  $("#nom-client").value = ""; $("#type-client").value = "particulier"; $("#rabais-valeur").value = ""; $("#rabais-motif").value = "";
  dessinerTicket();
  $("#ticket").classList.remove("ouvert");
  await fenetre({
    titre: gardee ? "Commande gardée" : `Commande n°${resultat.vente_id} — ${fmt(resultat.total)}`,
    contenu: `<div class="grosse-coche${gardee ? " attente" : ""}">${gardee ? "⏳" : "✓"}</div><p class="discret" style="text-align:center">${gardee
      ? "Pas de connexion pour l'instant : la commande est gardée sur cet appareil et sera enregistrée automatiquement dès que possible."
      : "Enregistrée en compta."}</p>`,
    boutons: [{ texte: "Nouvelle commande", classe: "principal" }],
  });
}

function demanderVendeur() {
  return fenetre({ titre: "Qui est à la caisse ?", contenu: `<p class="discret">Ton nom apparaîtra sur les tickets et dans les ventes par vendeur.</p>
    <input class="champ" id="champ-vendeur" maxlength="60" placeholder="Prénom Nom (RP)" value="${echapper(memoire.lire(CLE_VENDEUR, ""))}" autocomplete="off">`,
  boutons: [{ texte: "Valider", classe: "principal", action: (zone) => {
    const nom = $("#champ-vendeur", zone).value.trim();
    if (!nom) { $("#champ-vendeur", zone).focus(); return false; }
    memoire.ecrire(CLE_VENDEUR, nom); toast(`Bonne vente, ${nom} !`); return true;
  } }], quandOuverte: (zone) => $("#champ-vendeur", zone).addEventListener("keydown", (e) => {
    if (e.key === "Enter") zone.closest(".fenetre").querySelector(".actions .principal").click(); }) });
}

export async function afficher(vue) {
  squelette(vue);
  const racine = vue.firstElementChild;
  try { carte = await rpc("carte"); memoire.ecrire(CLE_CARTE, carte); }
  catch (err) {
    carte = memoire.lire(CLE_CARTE, null);
    if (!carte) { vue.innerHTML = `<div class="page"><div class="bloc"><h2 class="titre-bloc">Carte indisponible</h2><p>${echapper(messageErreur(err))}</p></div></div>`; return; }
    toast("Hors ligne : carte gardée en mémoire, les commandes partiront plus tard.", true);
  }
  if (!racine.isConnected) return;  // on a déjà changé de page
  articles = Object.fromEntries(carte.articles.map((a) => [a.id, a]));
  tarif = carte.tarifs[0]?.id;
  dessinerCarte();
  const b = memoire.lire(CLE_BROUILLON, null);
  if (b) {
    panier = new Map((b.panier || []).filter(([id]) => articles[id]));
    if (carte.tarifs.some((t) => t.id === b.tarif)) tarif = b.tarif;
    if (TYPES_CLIENT[b.type]) $("#type-client").value = b.type;
    $("#nom-client").value = b.client || "";
    if (b.rabais) { uniteRabais = b.rabais.unite === "montant" ? "montant" : "pourcent"; $("#rabais-valeur").value = b.rabais.valeur || ""; $("#rabais-motif").value = b.rabais.motif || ""; }
  }
  dessinerTicket();
  $("#btn-encaisser").addEventListener("click", encaisser);
  $("#btn-vider").addEventListener("click", () => { panier = new Map(); $("#rabais-valeur").value = ""; $("#rabais-motif").value = ""; dessinerTicket(); });
  ["#type-client", "#nom-client", "#rabais-valeur", "#rabais-motif"].forEach((s) => $(s).addEventListener("input", dessinerTicket));
  $$(".unite button").forEach((bt) => bt.addEventListener("click", () => { uniteRabais = bt.dataset.unite; dessinerTicket(); }));
  $("#btn-vendeur").addEventListener("click", demanderVendeur);
  $("#barre-mobile").addEventListener("click", () => $("#ticket").classList.add("ouvert"));
  $("#btn-fermer-ticket").addEventListener("click", () => $("#ticket").classList.remove("ouvert"));
  $("#puce-etat").onclick = viderFile;
  window.addEventListener("online", viderFile);
  minuterie = setInterval(viderFile, 15000);
  afficherEtat(); viderFile();
  if (!memoire.lire(CLE_VENDEUR, "")) demanderVendeur();
  return () => { clearInterval(minuterie); window.removeEventListener("online", viderFile); };
}

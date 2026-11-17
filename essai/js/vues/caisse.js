// Caisse : accessible sans code. Les prix sont recalculés par la base (fonction encaisser).
import { rpc } from "../api.js";
import { $, $$, echapper, fenetre, fmt, messageErreur, TYPES_CLIENT, toast } from "../outils.js";

const memoire = {
  lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(cle, val) { try { localStorage.setItem(cle, JSON.stringify(val)); } catch { /* stockage indisponible */ } },
};
const CLE_VENDEUR = "dispatch_vendeur", CLE_FILE = "dispatch_file_v2", CLE_BROUILLON = "dispatch_brouillon_v2", CLE_CARTE = "dispatch_carte", CLE_CLIENTS = "dispatch_clients_caisse";
const estReseau = (err) => /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(err?.message || String(err));

let carte, articles = {}, panier = new Map(), tarif, uniteRabais = "pourcent", minuterie, envoiEnCours = false;
let listeClients = [], pctManuel = null;   // pctManuel : remise / majoration tapée à la main (sinon celle du tarif)
const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const clientConnu = () => { const n = norm($("#nom-client").value); return n ? listeClients.find((c) => norm(c.nom) === n) || null : null; };

// --- Calcul (identique à la base : arrondi ,5 vers le haut) -----------------------------------------
function calculer() {
  const lignes = [...panier].filter(([id, q]) => articles[id] && q > 0).map(([id, q]) => ({ a: articles[id], q, montant: articles[id].prix * q }));
  const dollar = (c) => Math.round(c / 100) * 100;   // on ne joue pas les centimes (comme la base)
  const sousTotal = dollar(lignes.reduce((s, l) => s + l.montant, 0));
  const t0 = carte.tarifs.find((x) => x.id === tarif) || carte.tarifs[0] || { id: null, nom: "", pourcentage: 0 };
  const pct = pctManuel !== null ? pctManuel : Number(t0.pourcentage || 0);
  const t = pct === Number(t0.pourcentage || 0) ? t0 : { ...t0, nom: pct < 0 ? "Remise" : "Majoration", pourcentage: pct };
  const ajustement = dollar(sousTotal * pct / 100);
  const base = sousTotal + ajustement;
  let valeur = parseFloat(String($("#rabais-valeur").value).replace(",", "."));
  if (!Number.isFinite(valeur) || valeur < 0) valeur = 0;
  if (uniteRabais === "pourcent") valeur = Math.min(valeur, 100);
  let rabais = uniteRabais === "pourcent" ? dollar(base * valeur / 100) : Math.min(dollar(valeur * 100), base);
  rabais = Math.max(0, Math.min(rabais, base));
  return { lignes, sousTotal, ajustement, total: base - rabais, tarif: t, pct, rabais, rabaisValeur: rabais ? valeur : 0,
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
        <div><div class="etiquette">Client</div>
          <input class="champ" id="nom-client" list="liste-clients" placeholder="Nom (facultatif, sauf devis / facture)" maxlength="80" autocomplete="off">
          <datalist id="liste-clients"></datalist>
          <div class="info-client" id="info-client"></div>
          <select class="champ" id="type-client" aria-label="Type de client" style="margin-top:6px">${Object.entries(TYPES_CLIENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><div class="etiquette">Tarif · remise (−) ou majoration (+)</div><div class="ligne-tarif"><div class="segment" id="tarifs"></div>
          <label class="pct"><input class="champ" id="pourcentage" type="number" inputmode="decimal" step="any" min="-100" max="100" aria-label="Pourcentage"> %</label></div></div>
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
        <div class="actions-doc"><button class="btn" id="btn-devis" type="button" disabled>📝 Faire un devis</button>
          <button class="btn" id="btn-facture" type="button" disabled>🧾 Faire une facture</button></div>
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
  $$("#tarifs button").forEach((b) => b.addEventListener("click", () => { tarif = b.dataset.id; pctManuel = null; dessinerTicket(); }));
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
  const cli = clientConnu();
  const hebdo = !!cli?.hebdo;
  $("#btn-encaisser").disabled = !c.lignes.length;
  $("#btn-encaisser").textContent = !c.lignes.length ? "Encaisser" : hebdo ? `📅 Sur la facture de la semaine · ${fmt(c.total)}` : `Encaisser ${fmt(c.total)}`;
  $("#btn-encaisser").classList.toggle("hebdo", hebdo);
  $("#btn-devis").disabled = $("#btn-facture").disabled = !c.lignes.length;
  const champPct = $("#pourcentage");
  if (document.activeElement !== champPct) champPct.value = c.pct ? String(c.pct).replace(".", ",") : "0";
  champPct.classList.toggle("modifie", pctManuel !== null);
  $("#info-client").innerHTML = cli ? `<span class="badge">${echapper(TYPES_CLIENT[cli.type] || cli.type)}</span>`
    + (hebdo ? ` <span class="badge orange">📅 facturé à la semaine${cli.payeur ? ` → ${echapper(cli.payeur)}` : ""}</span>` : "")
    : $("#nom-client").value.trim() ? '<span class="discret">Nouveau client (choisis son type ci-dessous)</span>' : "";
  $("#type-client").classList.toggle("masque", !!cli);
  const nb = c.lignes.reduce((s, l) => s + l.q, 0);
  $("#barre-nb").textContent = nb ? `Voir la commande · ${nb} article${nb > 1 ? "s" : ""}` : "Panier vide";
  $("#barre-total").textContent = fmt(c.total);
  memoire.ecrire(CLE_BROUILLON, { panier: [...panier], tarif, pct: pctManuel, type: $("#type-client").value, client: $("#nom-client").value,
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

// mode : "caisse" (encaisser, ou facture de la semaine pour les clients cochés), "facture" ou "devis"
async function encaisser(mode = "caisse") {
  const c = calculer();
  if (!c.lignes.length) return;
  const cli = clientConnu();
  const nomClient = $("#nom-client").value.trim();
  if ((mode === "facture" || mode === "devis") && !nomClient) {
    toast(`Pour ${mode === "devis" ? "un devis" : "une facture"}, indique le nom du client.`, true);
    $("#ticket").classList.add("ouvert"); $("#nom-client").focus(); return;
  }
  const hebdo = mode === "caisse" && cli?.hebdo;
  const recap = c.lignes.map(({ a, q, montant }) => `<div><span>${q}× ${echapper(a.nom)}</span><span>${fmt(montant)}</span></div>`).join("")
    + (c.ajustement ? `<div><span>${echapper(texteTarif(c.tarif))}</span><span>${(c.ajustement > 0 ? "+" : "") + fmt(c.ajustement)}</span></div>` : "")
    + (c.rabais ? `<div class="vert"><span>${echapper(texteRabais(c))}</span><span>−${fmt(c.rabais)}</span></div>` : "")
    + `<div class="tot"><span>TOTAL</span><span>${fmt(c.total)}</span></div>`
    + `<div class="discret" style="margin-top:6px"><span>Client</span><span>${echapper(nomClient || "De passage")} · ${echapper(TYPES_CLIENT[cli?.type || $("#type-client").value])}${cli ? "" : nomClient && mode !== "caisse" ? " (nouveau)" : ""}</span></div>`;
  const textes = {
    caisse: hebdo ? [`Sur la facture de la semaine ?`, `Ajouter ${fmt(c.total)}`, `Rien n'est encaissé maintenant : la commande ira sur la facture de lundi${cli.payeur ? ` adressée à <strong>${echapper(cli.payeur)}</strong>` : ""}.`]
      : ["Encaisser ?", `Encaisser ${fmt(c.total)}`, ""],
    facture: ["Faire une facture ?", `Créer la facture ${fmt(c.total)}`, "La commande part en cuisine ; l'argent entre en compta quand la facture est payée."],
    devis: ["Faire un devis ?", `Créer le devis ${fmt(c.total)}`, "Rien n'est encaissé ni envoyé en cuisine. Le devis se transforme en facture quand le client accepte."],
  }[mode];
  const ok = await fenetre({ titre: textes[0], contenu: `<div class="recap">${recap}</div>${textes[2] ? `<p class="discret">${textes[2]}</p>` : ""}`,
    boutons: [{ texte: "Retour" }, { texte: textes[1], classe: "principal", valeur: true }] });
  if (!ok) return;
  const cmd = {
    uid: nouvelUid(), vendeur: memoire.lire(CLE_VENDEUR, "") || "Site",
    lignes: c.lignes.map(({ a, q }) => ({ id: a.id, nom: a.nom, qte: q })),
    tarif: c.tarif.id, type_client: cli?.type || $("#type-client").value, client: nomClient, client_id: cli?.id || null,
    rabais: c.rabais ? { type: c.rabaisUnite, valeur: c.rabaisValeur, motif: c.motif } : null,
  };
  if (pctManuel !== null) cmd.pourcentage = pctManuel;
  if (mode === "facture") { cmd.mode = "facture"; cmd.creer_client = true; }
  let resultat = null, gardee = false;
  try { resultat = await rpc(mode === "devis" ? "caisse_devis" : "encaisser", { p: cmd }); }
  catch (err) {
    if (!estReseau(err) || mode === "devis") { toast(messageErreur(err), true); return; }
    const file = memoire.lire(CLE_FILE, []); file.push(cmd); memoire.ecrire(CLE_FILE, file); gardee = true; afficherEtat();
  }
  panier = new Map(); tarif = carte.tarifs[0]?.id; uniteRabais = "pourcent"; pctManuel = null;
  $("#nom-client").value = ""; $("#type-client").value = "particulier"; $("#rabais-valeur").value = ""; $("#rabais-motif").value = "";
  dessinerTicket();
  $("#ticket").classList.remove("ouvert");
  if (mode !== "caisse" || !cli) chargerClients();   // un client a pu être créé
  let titre, texte;
  if (gardee) { titre = "Commande gardée"; texte = "Pas de connexion pour l'instant : la commande est gardée sur cet appareil et sera enregistrée automatiquement dès que possible."; }
  else if (mode === "devis") { titre = `Devis ${resultat.numero} — ${fmt(resultat.total)}`; texte = `Devis créé pour ${echapper(resultat.client)}. Un gérant le retrouve dans « Devis & factures » pour l'imprimer ou le transformer en facture.`; }
  else if (resultat.mode === "facture") { titre = `Facture ${resultat.facture} — ${fmt(resultat.total)}`; texte = `Facture à payer créée pour ${echapper(resultat.client)}. Commande n°${resultat.vente_id} envoyée en cuisine 🍳.`; }
  else if (resultat.mode === "semaine") { titre = `Commande n°${resultat.vente_id} — ${fmt(resultat.total)}`; texte = `Ajoutée à la facture de la semaine${resultat.payeur ? ` (${echapper(resultat.payeur)})` : ""}. Envoyée en cuisine 🍳.`; }
  else { titre = `Commande n°${resultat.vente_id} — ${fmt(resultat.total)}`; texte = "Enregistrée en compta et envoyée en cuisine 🍳."; }
  await fenetre({ titre, contenu: `<div class="grosse-coche${gardee ? " attente" : ""}">${gardee ? "⏳" : mode === "devis" ? "📝" : "✓"}</div><p class="discret" style="text-align:center">${texte}</p>`,
    boutons: [{ texte: "Nouvelle commande", classe: "principal" }] });
}

async function chargerClients() {
  try { listeClients = await rpc("caisse_clients"); memoire.ecrire(CLE_CLIENTS, listeClients); }
  catch { listeClients = memoire.lire(CLE_CLIENTS, []); }
  const dl = $("#liste-clients");
  if (dl) dl.innerHTML = listeClients.map((c) => `<option value="${echapper(c.nom)}">`).join("");
  if ($("#lignes")) dessinerTicket();
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
    pctManuel = typeof b.pct === "number" ? b.pct : null;
    if (TYPES_CLIENT[b.type]) $("#type-client").value = b.type;
    $("#nom-client").value = b.client || "";
    if (b.rabais) { uniteRabais = b.rabais.unite === "montant" ? "montant" : "pourcent"; $("#rabais-valeur").value = b.rabais.valeur || ""; $("#rabais-motif").value = b.rabais.motif || ""; }
  }
  dessinerTicket();
  $("#btn-encaisser").addEventListener("click", () => encaisser("caisse"));
  $("#btn-devis").addEventListener("click", () => encaisser("devis"));
  $("#btn-facture").addEventListener("click", () => encaisser("facture"));
  chargerClients();
  $("#pourcentage").addEventListener("input", (e) => {
    const v = parseFloat(String(e.target.value).replace(",", "."));
    pctManuel = Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0;
    dessinerTicket();
  });
  // client connu choisi : services publics → tarif services publics proposé d'office
  $("#nom-client").addEventListener("change", () => {
    const cli = clientConnu();
    const pub = carte.tarifs.find((t) => t.id === "public");
    if (cli?.type === "service_public" && pub && pctManuel === null) tarif = pub.id;
    dessinerTicket();
  });
  $("#btn-vider").addEventListener("click", () => { panier = new Map(); pctManuel = null; $("#rabais-valeur").value = ""; $("#rabais-motif").value = ""; dessinerTicket(); });
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

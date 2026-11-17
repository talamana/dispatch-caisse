// Devis et factures : création, encaissement, conversion, impression.
import { clients, facturerSiBesoin, nomsClients, oublierClients, q, rpc, table } from "../api.js";
import {
  $, $$, brancherActions, confirmer, dateCourte, depuisChamp, echapper, fenetre, fmt, messageErreur, semaineFr, tableau, toast, TYPES_CLIENT, versCentimes,
} from "../outils.js";

const STATUTS = {
  en_attente: ["⏳ En attente", "orange"], accepte: ["✅ Accepté", "vert"], refuse: ["❌ Refusé", "rouge"], converti: ["🧾 Facturé", ""],
  impayee: ["⏳ Impayée", "orange"], payee: ["✅ Payée", "vert"], annulee: ["🚫 Annulée", ""],
};
const badge = (s) => `<span class="badge ${STATUTS[s]?.[1] || ""}">${STATUTS[s]?.[0] || s}</span>`;

export async function afficher(vue, params) {
  const onglet = params[0] === "devis" ? "devis" : "facture";
  vue.innerHTML = `<div class="page"><div class="titre-page"><h1>Devis & factures</h1><span class="espace"></span>
    <button class="btn" data-action="nouveau" data-kind="devis">+ Nouveau devis</button>
    <button class="btn principal" data-action="nouveau" data-kind="facture">+ Nouvelle facture</button></div>
    <div class="onglets-page"><button data-onglet="factures" aria-selected="${onglet === "facture"}">Factures</button>
      <button data-onglet="devis" aria-selected="${onglet === "devis"}">Devis</button></div>
    <div id="semaine"></div>
    <div class="filtres" style="margin-bottom:12px"><select class="champ" id="filtre-statut"></select></div>
    <div id="liste"></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/factures/${b.dataset.onglet}`; }));
  const statuts = onglet === "devis" ? ["en_attente", "accepte", "refuse", "converti"] : ["impayee", "payee", "annulee"];
  const filtreStatut = $("#filtre-statut", vue), liste = $("#liste", vue);
  filtreStatut.innerHTML = `<option value="">Tous les statuts</option>` + statuts.map((s) => `<option value="${s}">${STATUTS[s][0]}</option>`).join("");
  let lignes = [], noms = {};
  const page = $(".page", vue);
  const visibles = () => (filtreStatut.value ? lignes.filter((d) => d.statut === filtreStatut.value) : lignes);

  // Factures à la semaine (services publics, entreprises cochées) : ce qui reste à facturer
  const dessinerSemaine = async () => {
    if (onglet !== "facture") return;
    const a = await rpc("a_facturer");
    const zoneS = $("#semaine", vue);
    if (!zoneS) return;
    const faire = a.filter((x) => x.a_faire), cours = a.filter((x) => !x.a_faire);
    zoneS.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📅 Facturation à la semaine</h2><span class="espace"></span>
      ${faire.length ? `<button class="btn principal" data-action="facturer">Créer les factures de la semaine passée (${faire.length})</button>` : ""}</div>
      <p class="discret">Les commandes des clients « facturés à la semaine » (services publics, entreprises cochées) sont regroupées :
        chaque lundi, une facture par payeur pour la semaine précédente. Elles sont créées automatiquement quand un gérant ouvre le site.</p>
      ${a.length ? tableau(a, [
        { titre: "Payeur", rendu: (x) => `<strong>${echapper(x.payeur)}</strong><div class="discret">${echapper((x.organismes || []).filter(Boolean).join(", "))}</div>` },
        { titre: "Semaine", rendu: (x) => `${semaineFr(x.semaine)} ${x.a_faire ? '<span class="badge orange">à facturer</span>' : '<span class="badge">en cours</span>'}` },
        { titre: "Commandes", classe: "droite", rendu: (x) => x.n },
        { titre: "Montant", classe: "droite", rendu: (x) => `<strong>${fmt(x.total)}</strong>` },
      ]) : '<div class="vide">Aucune commande en attente de facturation.</div>'}
      ${cours.length ? `<p class="discret">Semaine en cours : ${fmt(cours.reduce((s2, x) => s2 + x.total, 0))} — facturé lundi prochain.</p>` : ""}</div>`;
  };

  const charger = async () => {
    if (onglet === "facture") {
      const faites = await facturerSiBesoin();
      if (faites.length) toast(`📅 ${faites.length} facture(s) de la semaine créée(s).`);
      await dessinerSemaine();
    }
    [lignes, noms] = await Promise.all([q(table("documents").select("*").eq("kind", onglet).order("id", { ascending: false })), nomsClients()]);
    const ouverts = lignes.filter((d) => ["impayee", "en_attente", "accepte"].includes(d.statut));
    const total = ouverts.reduce((s, d) => s + d.total, 0);
    liste.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">${onglet === "devis" ? "📝 Devis" : "🧾 Factures"}</h2><span class="espace"></span>
      <span class="badge ${ouverts.length ? "orange" : "vert"}">${onglet === "devis" ? `${ouverts.length} en cours · ${fmt(total)}` : ouverts.length ? `${fmt(total)} à encaisser` : "Tout est encaissé"}</span></div>
      ${tableau(visibles(), [
        { titre: "Numéro", rendu: (d) => `<strong>${echapper(d.numero)}</strong>` },
        { titre: "Client", rendu: (d) => echapper(noms[d.client_id] || "—") },
        { titre: "Objet", rendu: (d) => echapper(d.lignes[0]?.description || "") + (d.lignes.length > 1 ? ` <span class="discret">(+${d.lignes.length - 1})</span>` : "") },
        { titre: "Date", rendu: (d) => dateCourte(d.date) + (d.echeance ? `<div class="${d.statut === "impayee" && new Date(d.echeance) < new Date() ? "rouge" : "discret"}">${onglet === "devis" ? "valable →" : "échéance"} ${dateCourte(d.echeance)}</div>` : "") },
        { titre: "Statut", rendu: (d) => badge(d.statut) },
        { titre: "Total", classe: "droite", rendu: (d) => `<strong>${fmt(d.total)}</strong>` },
      ], { vide: "Aucun document.", actions: (d) => {
        const b = [];
        if (d.statut === "impayee") b.push(`<button class="btn petit vert" data-action="payer">Encaisser</button>`);
        if (["en_attente", "accepte"].includes(d.statut)) b.push(`<button class="btn petit vert" data-action="convertir">→ Facture</button>`);
        if (d.statut === "en_attente") b.push(`<button class="btn petit" data-action="accepter">Accepté</button>`);
        if (["en_attente", "accepte"].includes(d.statut)) b.push(`<button class="btn petit" data-action="refuser">Refusé</button>`);
        b.push(`<a class="btn petit icone" href="#/imprimer/document/${d.id}" title="Imprimer / PDF">🖨️</a>`);
        if (d.statut === "impayee") b.push(`<button class="btn petit icone" data-action="annuler" title="Annuler la facture">🚫</button>`);
        if (d.statut === "payee") b.push(`<button class="btn petit" data-action="rembourser" title="Annuler l'encaissement">↩︎</button>`);
        return b.join(" ");
      } })}</div>`;
  };
  filtreStatut.addEventListener("change", charger);

  brancherActions(page, visibles, {
    nouveau: async (_, b) => { if (await editeurDocument(b.dataset.kind)) { if (b.dataset.kind !== onglet) location.hash = `#/factures/${b.dataset.kind === "devis" ? "devis" : "factures"}`; else charger(); } },
    payer: async (d) => {
      const r = await fenetre({ titre: `Encaisser ${d.numero}`, contenu: `<p>${fmt(d.total)} — ${echapper(noms[d.client_id] || "")}</p>
        <form class="form"><label class="plein">Date du paiement<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label></form>
        <p class="discret">Une recette est ajoutée au chiffre d'affaires.</p>`,
        boutons: [{ texte: "Annuler" }, { texte: "Encaisser", classe: "principal", action: async (z) => {
          await rpc("payer_facture", { p_id: d.id, p_quand: depuisChamp($("[name=date]", z).value, false) || new Date().toISOString() });
        } }] });
      if (r) { toast(`${d.numero} encaissée.`); charger(); }
    },
    convertir: async (d) => {
      const r = await fenetre({ titre: `Facturer ${d.numero}`, contenu: `<form class="form"><label class="plein">Échéance de paiement (facultatif)<input type="date" name="echeance"></label></form>`,
        boutons: [{ texte: "Annuler" }, { texte: "Créer la facture", classe: "principal", action: async (z) => {
          const f = await rpc("convertir_devis", { p_id: d.id, p_echeance: depuisChamp($("[name=echeance]", z).value, false) });
          toast(`Facture ${f.numero} créée.`);
        } }] });
      if (r) charger();
    },
    facturer: async () => {
      const faites = await facturerSiBesoin(true);
      toast(faites.length ? `${faites.length} facture(s) créée(s) : ${faites.map((f) => `${f.numero} ${f.client}`).join(", ")}` : "Rien à facturer.");
      charger();
    },
    accepter: async (d) => { await q(table("documents").update({ statut: "accepte" }).eq("id", d.id)); charger(); },
    refuser: async (d) => { await q(table("documents").update({ statut: "refuse" }).eq("id", d.id)); charger(); },
    annuler: async (d) => { if (await confirmer(`Annuler la facture ${d.numero} ? Si c'est une facture de la semaine, ses commandes repassent « à facturer ».`, "Annuler la facture")) { await q(table("documents").update({ statut: "annulee" }).eq("id", d.id)); charger(); } },
    rembourser: async (d) => {
      if (!(await confirmer(`Annuler l'encaissement de ${d.numero} ? La recette est retirée et la facture redevient impayée.`, "Annuler l'encaissement"))) return;
      await q(table("recettes").delete().eq("facture_id", d.id)); toast("Encaissement annulé."); charger();
    },
  });
  await charger();
}

// Fenêtre de création d'un devis ou d'une facture
export async function editeurDocument(kind) {
  const liste = await clients();
  const contenu = document.createElement("div");
  contenu.innerHTML = `<form class="form" id="form-doc">
      <label>Client<select name="client_id"><option value="">— Choisir —</option>${liste.map((c) => `<option value="${c.id}">${echapper(c.nom)}</option>`).join("")}<option value="nouveau">+ Nouveau client…</option></select></label>
      <label>${kind === "devis" ? "Valable jusqu'au" : "Échéance de paiement"}<input type="date" name="echeance"></label>
      <div class="plein masque" id="nouveau-client" style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
        <input class="champ" name="nouveau_nom" placeholder="Nom du nouveau client"><select class="champ" name="nouveau_type">${Object.entries(TYPES_CLIENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    </form>
    <div class="etiquette" style="margin-top:14px">Lignes</div>
    <div class="lignes-doc" id="lignes-doc"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <button class="btn petit" type="button" id="ajout-ligne">+ Ligne</button><strong id="total-doc">Total : 0 $</strong></div>
    <form class="form" style="margin-top:12px"><label class="plein">Note (facultatif)<textarea name="note" maxlength="500"></textarea></label></form>`;
  const ajouterLigne = (desc = "", qte = "1", pu = "") => {
    const l = document.createElement("div");
    l.className = "ligne-doc";
    l.innerHTML = `<input class="champ" placeholder="Description" value="${echapper(desc)}"><input class="champ" type="number" min="0" step="any" value="${qte}" title="Quantité">
      <input class="champ" inputmode="decimal" placeholder="Prix unit. $" value="${pu}"><span class="total">0 $</span><button class="btn petit icone" type="button" title="Retirer">✕</button>`;
    $("button", l).onclick = () => { l.remove(); recalculer(); };
    $$("input", l).forEach((i) => i.addEventListener("input", recalculer));
    $("#lignes-doc", contenu).appendChild(l);
  };
  const lire = () => $$(".ligne-doc", contenu).map((l) => {
    const [d, qte, pu] = $$("input", l).map((i) => i.value.trim());
    return { description: d, quantite: Number(qte), prix_unitaire: versCentimes(pu) };
  });
  const recalculer = () => {
    let total = 0;
    $$(".ligne-doc", contenu).forEach((l, i) => {
      const x = lire()[i], t = Number.isFinite(x.prix_unitaire) && x.quantite > 0 ? Math.round(x.quantite * x.prix_unitaire) : 0;
      $(".total", l).textContent = fmt(t); total += t;
    });
    $("#total-doc", contenu).textContent = `Total : ${fmt(total)}`;
  };
  ajouterLigne();
  $("#ajout-ligne", contenu).onclick = () => ajouterLigne();
  const selectClient = $("[name=client_id]", contenu);
  selectClient.onchange = () => $("#nouveau-client", contenu).classList.toggle("masque", selectClient.value !== "nouveau");
  return fenetre({ titre: kind === "devis" ? "Nouveau devis" : "Nouvelle facture", contenu, large: true, boutons: [
    { texte: "Annuler" },
    { texte: kind === "devis" ? "Créer le devis" : "Créer la facture", classe: "principal", action: async () => {
      const lignes = lire().filter((l) => l.description || l.prix_unitaire);
      if (!lignes.length) throw new Error("Ajoute au moins une ligne.");
      for (const l of lignes) {
        if (!l.description) throw new Error("Chaque ligne doit avoir une description.");
        if (!(l.quantite > 0) || !Number.isFinite(l.prix_unitaire) || l.prix_unitaire < 0) throw new Error(`Quantité ou prix invalide : ${l.description}`);
      }
      let clientId = selectClient.value;
      if (clientId === "nouveau") {
        const nom = $("[name=nouveau_nom]", contenu).value.trim();
        if (!nom) throw new Error("Donne un nom au nouveau client.");
        const c = await q(table("clients").insert({ nom, type: $("[name=nouveau_type]", contenu).value }).select().single());
        oublierClients(); clientId = c.id;
      }
      try {
        const d = await rpc("creer_document", { p: { kind, client_id: clientId || null, lignes,
          echeance: depuisChamp($("[name=echeance]", contenu).value, false), note: $("[name=note]", contenu).value } });
        toast(`${d.numero} créé${kind === "facture" ? "e" : ""}.`);
      } catch (e) { throw new Error(messageErreur(e)); }
    } },
  ] });
}

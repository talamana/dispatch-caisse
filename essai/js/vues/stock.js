// Stock & achats (gérants) : stock par logement, stock de base et « à commander », inventaire,
// achats (Raven / Sunny payés le lundi, supérette avancée par un gérant), dettes et remboursements.
import { q, rpc, table } from "../api.js";
import { lieuDAchat, prixChez } from "../cuisine_calc.js";
import {
  $, $$, brancherActions, confirmer, dateCourte, echapper, fenetre, FOURNISSEURS, fmt, formulaireEnFenetre, messageErreur,
  PAIEMENTS_ACHAT, PAYE_A_LA_SEMAINE, tableau, toast, versCentimes, enDollars,
} from "../outils.js";

const ONGLETS = [["stock", "📦 Stock"], ["commander", "🛒 À commander"], ["achats", "🚚 Achats & dettes"], ["inventaire", "📝 Inventaire"], ["logements", "🏠 Logements"]];
const nb = (v) => (Math.round(Number(v || 0) * 100) / 100).toLocaleString("fr-FR");
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function donnees() {
  const [logements, ingredients, stocks] = await Promise.all([
    q(table("logements").select("*").order("ordre").order("id")),
    q(table("ingredients").select("*").order("nom")),
    q(table("stocks").select("*")),
  ]);
  const qte = (ing, log) => Number(stocks.find((s) => s.ingredient === ing && s.logement_id === log)?.quantite || 0);
  const total = (ing) => stocks.filter((s) => s.ingredient === ing).reduce((s, x) => s + Number(x.quantite), 0);
  return { logements, ingredients, stocks, qte, total };
}

export async function afficher(vue, params) {
  const onglet = ONGLETS.some(([k]) => k === params[0]) ? params[0] : "stock";
  vue.innerHTML = `<div class="page large"><div class="titre-page"><h1>Stock & achats</h1></div>
    <div class="onglets-page">${ONGLETS.map(([k, v]) => `<button data-onglet="${k}" aria-selected="${k === onglet}">${v}</button>`).join("")}</div>
    <div id="contenu"><div class="vide">Chargement…</div></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/stock/${b.dataset.onglet}`; }));
  const zone = $("#contenu", vue);
  await ({ stock, commander, achats, inventaire, logements })[onglet](zone);
}

// --- Stock -------------------------------------------------------------------------------------------
async function stock(zone) {
  let d, lignes = [], filtre = "";
  const dessiner = () => {
    const f = sansAccent(filtre);
    lignes = d.ingredients.filter((i) => !f || sansAccent(i.nom).includes(f))
      .filter((i) => f || d.total(i.nom) !== 0 || i.stock_base != null);
    const bas = d.ingredients.filter((i) => i.stock_base != null && d.total(i.nom) < i.stock_base).length;
    $("#table-stock", zone).innerHTML = tableau(lignes, [
      { titre: "Ingrédient", rendu: (i) => `<strong>${echapper(i.nom)}</strong>${(i.composition || []).length ? ' <span class="badge">combiné</span>' : ""}` },
      ...d.logements.map((l) => ({ titre: echapper(l.nom), classe: "droite", rendu: (i) => {
        const v = d.qte(i.nom, l.id);
        return v ? `<span class="${v < 0 ? "rouge" : ""}">${nb(v)}</span>${i.logement_id === l.id ? " 📍" : ""}` : `<span class="discret">${i.logement_id === l.id ? "0 📍" : "—"}</span>`;
      } })),
      { titre: "Total", classe: "droite", rendu: (i) => `<strong>${nb(d.total(i.nom))}</strong>` },
      { titre: "Stock de base", classe: "droite", rendu: (i) => (i.stock_base != null ? nb(i.stock_base) : '<span class="discret">—</span>') },
      { titre: "État", rendu: (i) => {
        if (i.stock_base == null) return "";
        const manque = i.stock_base - d.total(i.nom);
        return manque > 0 ? `<span class="badge orange">commander ${nb(manque)}</span>` : '<span class="badge vert">ok</span>';
      } },
    ], { vide: filtre ? "Aucun ingrédient ne correspond." : "Aucun stock pour l'instant : fais un inventaire ou enregistre un achat.",
      actions: () => `<button class="btn petit icone" data-action="regler" title="Stock de base et logement habituel">⚙️</button>` });
    $("#resume-stock", zone).innerHTML = bas ? `<span class="badge orange">${bas} sous le stock de base</span> <a class="lien" href="#/stock/commander">À commander →</a>`
      : '<span class="badge vert">Tout est au-dessus du stock de base</span>';
  };
  const charger = async () => { d = await donnees(); dessiner(); };
  zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📦 Stock par logement</h2><span id="resume-stock"></span><span class="espace"></span>
      <input class="champ" id="filtre" placeholder="Chercher un ingrédient… (vide = ceux en stock)" style="max-width:300px">
      <a class="btn" href="#/stock/inventaire">📝 Inventaire</a></div>
      <p class="discret">📍 = logement habituel de l'ingrédient (la cuisine y prend en priorité). Le stock baisse tout seul quand la cuisine cuisine,
        et remonte quand vous enregistrez un achat. Un nombre rouge veut dire qu'on a cuisiné sans l'avoir en stock : à vérifier à l'inventaire.</p>
      <div id="table-stock"></div></div>
    <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🕑 Derniers mouvements</h2></div><div id="mouvements"></div></div>`;
  $("#filtre", zone).addEventListener("input", (e) => { filtre = e.target.value; dessiner(); });
  brancherActions(zone, () => lignes, {
    regler: (i) => formulaireEnFenetre(`${i.nom} — réglages`, [
      { nom: "stock_base", libelle: "Stock de base (quantité à garder)", type: "nombre", min: 0, aide: "En dessous, l'ingrédient apparaît dans « À commander »." },
      { nom: "logement_id", libelle: "Logement habituel", type: "choix", entier: true, options: [["", "—"], ...d.logements.map((l) => [l.id, l.nom])] },
    ], i, async (o) => { await q(table("ingredients").update(o).eq("nom", i.nom)); toast("Réglages enregistrés."); charger(); }),
  });
  await charger();
  const mv = await q(table("mouvements_stock").select("*").order("date", { ascending: false }).limit(40));
  const nomLog = (id) => d.logements.find((l) => l.id === id)?.nom || "—";
  const raisons = { achat: "🚚 achat", cuisson: "🍳 cuisson", fabrication: "🧪 fabrication", inventaire: "📝 inventaire", transfert: "↔️ transfert", correction: "✏️ correction" };
  $("#mouvements", zone).innerHTML = tableau(mv, [
    { titre: "Date", rendu: (m) => dateCourte(m.date, true) },
    { titre: "Ingrédient", rendu: (m) => echapper(m.ingredient) },
    { titre: "Logement", rendu: (m) => echapper(nomLog(m.logement_id)) },
    { titre: "Raison", rendu: (m) => `${raisons[m.raison] || m.raison}${m.ref ? ` <span class="discret">${echapper(m.ref)}</span>` : ""}${m.par ? ` <span class="discret">· ${echapper(m.par)}</span>` : ""}` },
    { titre: "Quantité", classe: "droite", rendu: (m) => `<strong class="${m.delta < 0 ? "rouge" : "vert"}">${m.delta > 0 ? "+" : ""}${nb(m.delta)}</strong>` },
  ], { vide: "Aucun mouvement." });
}

// --- À commander -------------------------------------------------------------------------------------------
async function commander(zone) {
  const d = await donnees();
  const manques = d.ingredients.filter((i) => i.stock_base != null && d.total(i.nom) < i.stock_base)
    .map((i) => {
      const qte = Math.ceil(i.stock_base - d.total(i.nom));
      const lieu = lieuDAchat(i);
      return { ...i, qte, lieu, prix: prixChez(i, lieu) };
    });
  const groupes = new Map();
  for (const m of manques) {
    const g = groupes.get(m.lieu) || { lieu: m.lieu, lignes: [], total: 0, sansPrix: 0 };
    g.lignes.push(m);
    if (m.prix == null) g.sansPrix++; else g.total += Math.round(m.prix * m.qte / 100) * 100;
    groupes.set(m.lieu, g);
  }
  const liste = [...groupes.values()];
  zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🛒 À commander</h2><span class="espace"></span>
      <span class="discret">Stock de base − stock actuel, au fournisseur le moins cher (ou celui choisi dans Carte › Ingrédients).</span></div>
      ${liste.length ? liste.map((g, n) => `<div class="lieu-achat"><div class="lieu-tete"><strong>${echapper(g.lieu || "❓ Lieu à définir (aucun prix)")}</strong><span class="espace"></span>
          ${g.total ? fmt(g.total) : ""}${g.sansPrix ? ` <span class="discret">+ ${g.sansPrix} sans prix</span>` : ""}
          <button class="btn petit" data-copier="${n}">📋 Copier</button>
          <button class="btn petit principal" data-recu="${n}">✓ Reçu → enregistrer l'achat</button></div>
        <table class="liste compacte"><tbody>${g.lignes.map((m) => `<tr><td>${echapper(m.nom)}</td>
          <td class="droite discret">${nb(d.total(m.nom))} / ${nb(m.stock_base)}</td><td class="droite"><strong>${m.qte}</strong></td>
          <td class="droite discret">${m.prix != null ? `${fmt(m.prix)} /u` : "—"}</td><td class="droite">${m.prix != null ? fmt(Math.round(m.prix * m.qte / 100) * 100) : "—"}</td></tr>`).join("")}</tbody></table></div>`).join("")
      : '<div class="vide">Rien à commander : tout est au-dessus du stock de base. 🎉</div>'}
      <p class="discret">Le stock de base de chaque ingrédient se règle dans l'onglet Stock (⚙️).</p></div>`;
  $$("[data-copier]", zone).forEach((b) => (b.onclick = async () => {
    const g = liste[Number(b.dataset.copier)];
    const texte = `Commande ${g.lieu || ""} — Le Dispatch :\n` + g.lignes.map((m) => `- ${m.qte} × ${m.nom}`).join("\n");
    try { await navigator.clipboard.writeText(texte); toast("Commande copiée : colle-la dans le message au fournisseur."); }
    catch { await fenetre({ titre: "Commande", contenu: `<textarea class="champ" rows="12" readonly>${echapper(texte)}</textarea>`, boutons: [{ texte: "Fermer" }] }); }
  }));
  $$("[data-recu]", zone).forEach((b) => (b.onclick = async () => {
    const g = liste[Number(b.dataset.recu)];
    const fournisseur = g.lieu === "Raven / Sunny" ? "Raven" : g.lieu || "Supérette";
    if (await formulaireAchat(d, { fournisseur, lignes: g.lignes.map((m) => ({ nom: m.nom, qte: m.qte, prix: m.prix })) })) commander(zone);
  }));
}

// --- Achats, dettes, avances --------------------------------------------------------------------------------
async function formulaireAchat(d, depart = {}) {
  const gerants = [...new Set(d.logements.map((l) => l.gerant).filter(Boolean))];
  const paiementDefaut = (f) => (["Raven", "Sunny"].includes(f) ? "semaine" : "avance");
  const contenu = document.createElement("div");
  const f0 = depart.fournisseur || "Raven";
  contenu.innerHTML = `<form class="form" id="form-achat">
      <label>Fournisseur<select name="fournisseur">${FOURNISSEURS.map((f) => `<option ${f === f0 ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label>Paiement<select name="paiement">${Object.entries(PAIEMENTS_ACHAT).map(([k, v]) => `<option value="${k}" ${k === paiementDefaut(f0) ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label id="champ-avance">Avancé par (gérant)<input name="avance_par" list="liste-gerants" autocomplete="off" placeholder="Nom du gérant">
        <datalist id="liste-gerants">${gerants.map((g) => `<option value="${echapper(g)}">`).join("")}</datalist></label>
      <label>Rangé dans<select name="logement_id"><option value="">— Ne pas ajouter au stock —</option>${d.logements.map((l, i) => `<option value="${l.id}" ${i === 0 ? "selected" : ""}>${echapper(l.nom)}${l.gerant ? ` (${echapper(l.gerant)})` : ""}</option>`).join("")}</select></label>
      <label>Date<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
    </form>
    <div class="etiquette" style="margin-top:12px">Ingrédients</div>
    <datalist id="liste-ingredients">${d.ingredients.map((i) => `<option value="${echapper(i.nom)}">`).join("")}</datalist>
    <div class="lignes-doc" id="lignes-achat"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <button class="btn petit" type="button" id="ajout-ligne">+ Ingrédient</button><strong id="total-achat">Total : 0 $</strong></div>
    <form class="form" style="margin-top:10px"><label class="plein">Note (facultatif)<input name="note" maxlength="300"></label></form>`;
  const form = $("#form-achat", contenu);
  const prixPour = (nom) => {
    const i = d.ingredients.find((x) => sansAccent(x.nom) === sansAccent(nom));
    const f = form.elements.fournisseur.value;
    return prixChez(i, f === "Autre" ? "Supérette" : f);
  };
  const recalculer = () => {
    let total = 0;
    $$(".ligne-doc", contenu).forEach((l) => {
      const [, qte, pu] = $$("input", l).map((x) => x.value.trim());
      const t = Math.round((Number(qte.replace(",", ".")) || 0) * (versCentimes(pu) || 0) / 100) * 100;
      $(".total", l).textContent = fmt(t); total += t;
    });
    $("#total-achat", contenu).textContent = `Total : ${fmt(total)}`;
  };
  const ajouter = (nom = "", qte = "", prix = null) => {
    const l = document.createElement("div");
    l.className = "ligne-doc";
    l.innerHTML = `<input class="champ" list="liste-ingredients" placeholder="Ingrédient" value="${echapper(nom)}" autocomplete="off">
      <input class="champ" inputmode="decimal" placeholder="Qté" value="${echapper(String(qte))}">
      <input class="champ" inputmode="decimal" placeholder="Prix unit. $" value="${prix != null ? echapper(enDollars(prix)) : ""}">
      <span class="total">0 $</span><button class="btn petit icone" type="button" title="Retirer">✕</button>`;
    const [champNom, , champPrix] = $$("input", l);
    champNom.addEventListener("change", () => { if (!champPrix.value) { const p = prixPour(champNom.value); if (p != null) champPrix.value = enDollars(p); } recalculer(); });
    $$("input", l).forEach((x) => x.addEventListener("input", recalculer));
    $("button", l).onclick = () => { l.remove(); recalculer(); };
    $("#lignes-achat", contenu).appendChild(l);
  };
  (depart.lignes?.length ? depart.lignes : [{}]).forEach((x) => ajouter(x.nom || "", x.qte || "", x.prix ?? null));
  recalculer();
  $("#ajout-ligne", contenu).onclick = () => ajouter();
  // maraîcher / supérette : pas d'entreprise RP, donc pas de « à payer lundi »
  const majPaiement = () => {
    const hebdo = PAYE_A_LA_SEMAINE.includes(form.elements.fournisseur.value);
    const opt = form.elements.paiement.querySelector('option[value="semaine"]');
    opt.hidden = opt.disabled = !hebdo;
    if (!hebdo && form.elements.paiement.value === "semaine") form.elements.paiement.value = "avance";
  };
  const majAvance = () => $("#champ-avance", contenu).classList.toggle("masque", form.elements.paiement.value !== "avance");
  form.elements.fournisseur.onchange = () => { form.elements.paiement.value = paiementDefaut(form.elements.fournisseur.value); majPaiement(); majAvance(); };
  majPaiement();
  form.elements.paiement.onchange = majAvance;
  majAvance();
  return fenetre({ titre: "Enregistrer un achat", contenu, large: true, boutons: [
    { texte: "Annuler" },
    { texte: "Enregistrer", classe: "principal", action: async () => {
      const lignes = $$(".ligne-doc", contenu).map((l) => {
        const [nom, qte, pu] = $$("input", l).map((x) => x.value.trim());
        return { nom, qte: Number(qte.replace(",", ".")), prix: pu ? versCentimes(pu) : 0 };
      }).filter((x) => x.nom);
      if (!lignes.length) throw new Error("Ajoute au moins un ingrédient.");
      for (const x of lignes) if (!(x.qte > 0) || !Number.isFinite(x.prix) || x.prix < 0) throw new Error(`Quantité ou prix invalide : ${x.nom}`);
      const date = form.elements.date.value;
      try {
        const a = await rpc("enregistrer_achat", { p: {
          fournisseur: form.elements.fournisseur.value, paiement: form.elements.paiement.value,
          avance_par: form.elements.avance_par.value.trim() || null, logement_id: form.elements.logement_id.value || null,
          date: date && date !== new Date().toISOString().slice(0, 10) ? new Date(date + "T12:00").toISOString() : null,
          note: $("[name=note]", contenu).value, lignes,
        } });
        toast(`Achat enregistré (${fmt(a.total)})${a.logement_id ? " et ajouté au stock" : ""}.`);
      } catch (e) { throw new Error(messageErreur(e)); }
    } },
  ] });
}

async function achats(zone) {
  let d, liste = [], dettes = [], avances = [];
  const charger = async () => {
    [d, liste, dettes, avances] = await Promise.all([donnees(), q(table("achats").select("*").order("date", { ascending: false }).limit(60)),
      rpc("dettes_fournisseurs"), rpc("avances_dues")]);
    const nomLog = (id) => d.logements.find((l) => l.id === id)?.nom || "";
    zone.innerHTML = `<div class="grille-2">
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🚚 À payer aux fournisseurs</h2></div>
        <p class="discret">Raven et Sunny se paient en une fois, le lundi ou le mardi, pour les livraisons de la semaine précédente.
          Le maraîcher et la supérette (pas des entreprises RP) se paient toujours sur place.</p>
        ${dettes.length ? `<ul class="alertes">${dettes.map((x, n) => `<li><div><strong>${echapper(x.fournisseur)}</strong>
            <div class="discret">${x.n} livraison(s) depuis le ${dateCourte(x.depuis)}${x.semaine_en_cours ? ` · ${fmt(x.semaine_en_cours)} de cette semaine (lundi prochain)` : ""}</div></div>
            <span style="margin-left:auto;text-align:right"><strong>${fmt(x.du_maintenant)}</strong> à payer
            ${x.du_maintenant ? `<button class="btn petit vert" data-payer="${n}">Payé</button>` : ""}
            ${x.semaine_en_cours ? `<button class="btn petit" data-payer-tout="${n}" title="Payer aussi cette semaine">Tout (${fmt(x.total)})</button>` : ""}</span></li>`).join("")}</ul>`
          : '<div class="vide">Rien à payer aux fournisseurs.</div>'}</div>
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">💸 Avances des gérants</h2></div>
        <p class="discret">Achats payés de leur poche (supérette, maraîcher…) : l'entreprise leur doit ces montants.</p>
        ${avances.length ? `<ul class="alertes">${avances.map((x, n) => `<li><div><strong>${echapper(x.gerant)}</strong>
            <div class="discret">${x.depenses.map((p) => `${dateCourte(p.date)} ${echapper(p.fournisseur || "")} ${fmt(p.montant)}`).join(" · ")}</div></div>
            <span style="margin-left:auto"><strong>${fmt(x.total)}</strong> <button class="btn petit vert" data-rembourser="${n}">Remboursé</button></span></li>`).join("")}</ul>`
          : '<div class="vide">Aucune avance à rembourser.</div>'}</div></div>
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🧾 Achats</h2><span class="espace"></span>
        <button class="btn principal" data-action="nouveau">+ Enregistrer un achat</button></div>
        ${tableau(liste, [
          { titre: "Date", rendu: (a) => dateCourte(a.date) },
          { titre: "Fournisseur", rendu: (a) => `<strong>${echapper(a.fournisseur)}</strong>${a.note ? `<div class="discret">${echapper(a.note)}</div>` : ""}` },
          { titre: "Contenu", rendu: (a) => echapper(a.lignes.map((l) => `${nb(l.qte)}× ${l.nom}`).join(", ")) + (a.logement_id ? `<div class="discret">📍 ${echapper(nomLog(a.logement_id))}</div>` : "") },
          { titre: "Paiement", rendu: (a) => a.paiement === "semaine" ? (a.paye_le ? '<span class="badge vert">payé</span>' : '<span class="badge orange">à payer lundi</span>')
              : a.paiement === "avance" ? `<span class="badge">avancé par ${echapper(a.avance_par || "?")}</span>` : '<span class="badge vert">payé</span>' },
          { titre: "Total", classe: "droite", rendu: (a) => `<strong>${fmt(a.total)}</strong>` },
        ], { vide: "Aucun achat enregistré." })}</div>`;
    $$("[data-payer]", zone).forEach((b) => (b.onclick = () => payer(dettes[Number(b.dataset.payer)], false)));
    $$("[data-payer-tout]", zone).forEach((b) => (b.onclick = () => payer(dettes[Number(b.dataset.payerTout)], true)));
    $$("[data-rembourser]", zone).forEach((b) => (b.onclick = async () => {
      const x = avances[Number(b.dataset.rembourser)];
      if (!(await confirmer(`${x.gerant} a bien été remboursé de ${fmt(x.total)} ?`, "Oui, remboursé"))) return;
      await rpc("rembourser_avances", { p_gerant: x.gerant }); toast(`Remboursement de ${x.gerant} noté.`); charger();
    }));
  };
  const payer = async (x, tout) => {
    const montant = tout ? x.total : x.du_maintenant;
    if (!(await confirmer(`Payer ${fmt(montant)} à ${x.fournisseur} ? Une dépense « matières premières » est ajoutée à la compta.`, "Payer"))) return;
    try { const r = await rpc("payer_fournisseur", { p_fournisseur: x.fournisseur, p_tout: tout }); toast(`${x.fournisseur} payé : ${fmt(r.total)}.`); }
    catch (e) { toast(messageErreur(e), true); }
    charger();
  };
  brancherActions(zone, () => liste, { nouveau: async () => { if (await formulaireAchat(d)) charger(); } });
  await charger();
}

// --- Inventaire ----------------------------------------------------------------------------------------------
async function inventaire(zone) {
  const d = await donnees();
  if (!d.logements.length) { zone.innerHTML = '<div class="bloc"><div class="vide">Ajoute d\'abord un logement (onglet Logements).</div></div>'; return; }
  let tous = false;
  const dessiner = () => {
    const ings = d.ingredients.filter((i) => tous || i.stock_base != null || d.total(i.nom) !== 0 || d.logements.some((l) => d.qte(i.nom, l.id)));
    $("#grille-inv", zone).innerHTML = `<table class="liste compacte inventaire"><thead><tr><th>Ingrédient</th>${d.logements.map((l) => `<th class="droite">${echapper(l.nom)}</th>`).join("")}</tr></thead>
      <tbody>${ings.map((i) => `<tr><td>${echapper(i.nom)}</td>${d.logements.map((l) => `<td class="droite"><input class="champ petit-nombre" type="number" min="0" step="any"
        data-ing="${echapper(i.nom)}" data-log="${l.id}" value="${Math.max(0, d.qte(i.nom, l.id))}" data-avant="${d.qte(i.nom, l.id)}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📝 Inventaire</h2><span class="espace"></span>
      <label class="case"><input type="checkbox" id="tous"> Tous les ingrédients</label>
      <input class="champ" id="par" placeholder="Compté par…" style="max-width:180px">
      <button class="btn principal" id="enregistrer">Enregistrer l'inventaire</button></div>
    <p class="discret">Tape ce que vous avez réellement compté dans chaque logement. Seules les cases modifiées sont enregistrées ; l'écart est gardé dans les mouvements.</p>
    <div id="grille-inv"></div></div>`;
  $("#tous", zone).onchange = (e) => { tous = e.target.checked; dessiner(); };
  dessiner();
  $("#enregistrer", zone).onclick = async () => {
    const changes = $$("[data-ing]", zone).filter((c) => c.value !== "" && Number(c.value) !== Number(c.dataset.avant))
      .map((c) => ({ ingredient: c.dataset.ing, logement_id: Number(c.dataset.log), quantite: Number(c.value) }));
    if (!changes.length) { toast("Aucune quantité modifiée."); return; }
    try {
      const ecarts = await rpc("inventaire", { p: changes, p_par: $("#par", zone).value.trim() || null });
      const nomLog = (id) => d.logements.find((l) => l.id === id)?.nom || "";
      await fenetre({ titre: "Inventaire enregistré", contenu: `<table class="liste compacte"><thead><tr><th>Ingrédient</th><th>Logement</th><th class="droite">Prévu</th><th class="droite">Compté</th><th class="droite">Écart</th></tr></thead><tbody>
        ${ecarts.map((e) => `<tr><td>${echapper(e.ingredient)}</td><td>${echapper(nomLog(e.logement_id))}</td><td class="droite">${nb(e.avant)}</td><td class="droite">${nb(e.apres)}</td>
        <td class="droite"><strong class="${e.apres < e.avant ? "rouge" : "vert"}">${e.apres > e.avant ? "+" : ""}${nb(e.apres - e.avant)}</strong></td></tr>`).join("")}</tbody></table>`,
        boutons: [{ texte: "OK", classe: "principal" }] });
      inventaire(zone);
    } catch (e) { toast(messageErreur(e), true); }
  };
}

// --- Logements -----------------------------------------------------------------------------------------------
async function logements(zone) {
  let lignes = [];
  const champs = [
    { nom: "nom", libelle: "Nom du logement", requis: true },
    { nom: "gerant", libelle: "Gérant (chez qui)" },
    { nom: "note", libelle: "Note (adresse, accès…)", plein: true },
    { nom: "ordre", libelle: "Ordre d'affichage", type: "nombre" },
  ];
  const charger = async () => {
    lignes = await q(table("logements").select("*").order("ordre").order("id"));
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🏠 Logements</h2><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Ajouter un logement</button></div>
      <p class="discret">Là où le stock de base est rangé. La cuisine indique dans quel logement aller chercher chaque ingrédient.</p>
      ${tableau(lignes, [
        { titre: "Logement", rendu: (l) => `<strong>${echapper(l.nom)}</strong>${l.note ? `<div class="discret">${echapper(l.note)}</div>` : ""}` },
        { titre: "Chez", rendu: (l) => echapper(l.gerant || "") },
      ], { vide: "Aucun logement.", actions: () => `<button class="btn petit icone" data-action="modifier">✏️</button> <button class="btn petit icone" data-action="supprimer">🗑</button>` })}</div>`;
  };
  const enregistrer = (id) => async (o) => { o.ordre = o.ordre ?? 0; await q(id ? table("logements").update(o).eq("id", id) : table("logements").insert(o)); toast("Logement enregistré."); charger(); };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouveau logement", champs, {}, enregistrer(null)),
    modifier: (l) => formulaireEnFenetre(`Modifier ${l.nom}`, champs, l, enregistrer(l.id)),
    supprimer: async (l) => {
      if (!(await confirmer(`Supprimer ${l.nom} ? Le stock noté dans ce logement sera effacé.`, "Supprimer"))) return;
      await q(table("logements").delete().eq("id", l.id)); toast("Logement supprimé."); charger();
    },
  });
  await charger();
}

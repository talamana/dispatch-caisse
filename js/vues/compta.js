// Compta : bilan et déclaration (Art. III), ventes de la caisse, recettes, dépenses, dons.
import { clients, nomsClients, q, rpc, table } from "../api.js";
import {
  $, BENEFICIAIRES, bornesMois, brancherActions, CATEGORIES_DEPENSE, confirmer, dateCourte, dateFr, decalerMois, echapper,
  fmt, formulaireEnFenetre, libelleMois, moisCourant, NATURES_DON, options, pourcent, tableau, toast, TYPES_CLIENT,
} from "../outils.js";

const ONGLETS = [["bilan", "Bilan & déclaration"], ["ventes", "Ventes caisse"], ["recettes", "Recettes"], ["depenses", "Dépenses"], ["dons", "Dons"]];
let mois = moisCourant();

export async function afficher(vue, params) {
  const onglet = ONGLETS.some(([k]) => k === params[0]) ? params[0] : "bilan";
  if (params[1] && /^\d{4}-\d{2}$/.test(params[1])) mois = params[1];
  vue.innerHTML = `<div class="page">
    <div class="titre-page"><h1>Compta</h1><span class="espace"></span>
      <div class="filtres"><button class="btn icone" id="mois-avant" title="Mois précédent">◀</button>
        <strong id="mois-libelle" style="min-width:150px;text-align:center">${libelleMois(mois)}</strong>
        <button class="btn icone" id="mois-apres" title="Mois suivant">▶</button></div></div>
    <div class="onglets-page">${ONGLETS.map(([k, v]) => `<button type="button" data-onglet="${k}" aria-selected="${k === onglet}">${v}</button>`).join("")}</div>
    <div id="contenu"></div></div>`;
  $("#mois-avant", vue).onclick = () => { location.hash = `#/compta/${onglet}/${decalerMois(mois, -1)}`; };
  $("#mois-apres", vue).onclick = () => { location.hash = `#/compta/${onglet}/${decalerMois(mois, 1)}`; };
  vue.querySelectorAll("[data-onglet]").forEach((b) => (b.onclick = () => { location.hash = `#/compta/${b.dataset.onglet}/${mois}`; }));
  const zone = $("#contenu", vue);
  await ({ bilan, ventes, recettes, depenses, dons })[onglet](zone);
}

// --- Bilan et déclaration ------------------------------------------------------------------------------
async function bilan(zone) {
  const b = await rpc("bilan", { p_mois: mois });
  const ligne = (texte, montant, gras) => `<tr><td>${gras ? `<strong>${texte}</strong>` : texte}</td><td class="droite nowrap">${gras ? `<strong>${montant}</strong>` : montant}</td></tr>`;
  const section = (t) => `<tr><td colspan="2" class="discret" style="padding-top:16px;font-size:12px;letter-spacing:1px;text-transform:uppercase">${t}</td></tr>`;
  const decl = b.declaration;
  const enCours = mois >= moisCourant();
  const enRetard = !decl && !enCours && new Date() > new Date(b.limite_declaration);
  let statut;
  if (decl) statut = `<span class="badge vert">✅ Déclarée et réglée le ${dateFr(decl.declaree_le, true)}</span> <span class="discret">— impôt déclaré : ${fmt(decl.impot)}</span>`
    + (decl.benefice !== b.benefice ? `<p class="orange">⚠️ Les écritures ont changé depuis : bénéfice déclaré ${fmt(decl.benefice)}, bénéfice actuel ${fmt(b.benefice)}.</p>` : "");
  else if (enCours) statut = `<span class="badge">Mois en cours</span> <span class="discret">— à déclarer à la Mairie avant le ${dateFr(b.limite_declaration)}.</span>`;
  else statut = `<span class="badge ${enRetard ? "rouge" : "orange"}">${enRetard ? "⚠️ En retard" : "À déclarer"}</span> <span class="discret">— à déclarer et régler à la Mairie avant le <strong>${dateFr(b.limite_declaration)}</strong>.</span>`;

  zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🏛️ Déclaration de ${libelleMois(mois)}</h2><span class="espace"></span>
      <a class="btn" href="#/imprimer/declaration/${mois}">🖨️ Imprimer / PDF</a>
      ${!decl && !enCours ? `<button class="btn vert" id="btn-declarer">J'ai déclaré et payé</button>` : ""}
      ${decl ? `<button class="btn" id="btn-annuler-decl">Annuler la déclaration</button>` : ""}</div>
      <p style="margin:0">${statut}</p></div>
    <div class="grille-2">
      <div class="bloc"><table class="liste">
        ${section("Chiffre d'affaires")}
        ${Object.entries(b.ca_par_type).map(([k, v]) => ligne(`Recettes — ${TYPES_CLIENT[k] || k}`, fmt(v))).join("")}
        ${ligne("Total chiffre d'affaires", fmt(b.ca), true)}
        ${section("Dépenses déductibles")}
        ${Object.entries(b.deductibles_par_categorie).map(([k, v]) => ligne(CATEGORIES_DEPENSE[k] || k, fmt(v))).join("")}
        ${ligne("Total dépenses déductibles", fmt(b.depenses_deductibles), true)}
        ${b.depenses_en_attente ? ligne(`<span class="orange">⏳ « Autre » en attente de validation Mairie (non déduites)</span>`, fmt(b.depenses_en_attente)) : ""}
      </table></div>
      <div class="bloc"><table class="liste">
        ${section("Imposition (Art. III)")}
        ${ligne("Bénéfice imposable (CA − dépenses déductibles)", fmt(b.benefice), true)}
        ${ligne("Taux", pourcent(b.taux))}
        ${ligne("Impôt dû", fmt(b.impot), true)}
        ${section("Après impôt (non déductible)")}
        ${ligne("Rémunération des intérimaires", fmt(b.paies))}
        ${ligne("Parts patronales", fmt(b.parts_patronales))}
        ${ligne("Dépenses non déductibles et en attente", fmt(b.depenses_non_deductibles + b.depenses_en_attente))}
        ${ligne("Dons", fmt(b.dons))}
        ${ligne("Résultat net", fmt(b.resultat_net), true)}
      </table></div></div>`;
  $("#btn-declarer", zone)?.addEventListener("click", async () => {
    if (!(await confirmer(`Confirmer que la déclaration de ${libelleMois(mois)} est faite et l'impôt (${fmt(b.impot)}) payé à la Mairie ?`))) return;
    try { await rpc("valider_declaration", { p_mois: mois }); toast("Déclaration enregistrée."); bilan(zone); } catch (e) { toast(e.message, true); }
  });
  $("#btn-annuler-decl", zone)?.addEventListener("click", async () => {
    if (!(await confirmer("Annuler cette déclaration (enregistrée par erreur) ?", "Annuler la déclaration"))) return;
    await q(table("declarations").delete().eq("mois", mois)); toast("Déclaration annulée."); bilan(zone);
  });
}

// --- Ventes de la caisse -----------------------------------------------------------------------------------
async function ventes(zone) {
  const { debut, fin } = bornesMois(mois);
  let lignes = [];
  const charger = async () => {
    lignes = await q(table("ventes").select("*").gte("date", debut).lt("date", fin).order("date", { ascending: false }));
    const total = lignes.reduce((s, v) => s + v.total, 0), rabais = lignes.reduce((s, v) => s + v.rabais, 0);
    const parArticle = {};
    lignes.forEach((v) => v.lignes.forEach((l) => { parArticle[l.nom] = (parArticle[l.nom] || 0) + l.qte; }));
    const top = Object.entries(parArticle).sort((a, b) => b[1] - a[1]).slice(0, 8);
    zone.innerHTML = `<div class="kpis"><div class="kpi"><div class="etiquette">Commandes</div><div class="valeur">${lignes.length}</div></div>
      <div class="kpi"><div class="etiquette">Encaissé</div><div class="valeur">${fmt(total)}</div></div>
      <div class="kpi"><div class="etiquette">Rabais accordés</div><div class="valeur">${fmt(rabais)}</div></div>
      <div class="kpi"><div class="etiquette">Meilleure vente</div><div class="valeur" style="font-size:20px">${top[0] ? `${echapper(top[0][0])} ×${top[0][1]}` : "—"}</div></div></div>
      <div class="bloc">${tableau(lignes, [
        { titre: "N°", rendu: (v) => `<strong>${v.id}</strong>` },
        { titre: "Date", rendu: (v) => dateCourte(v.date, true) },
        { titre: "Commande", rendu: (v) => echapper(v.lignes.map((l) => `${l.qte}× ${l.nom}`).join(", ")) },
        { titre: "Tarif / rabais", rendu: (v) => [v.ajustement ? `<span class="badge">${echapper(v.tarif)} ${v.ajustement > 0 ? "+" : ""}${fmt(v.ajustement)}</span>` : "",
          v.rabais ? `<span class="badge vert">−${fmt(v.rabais)}${v.motif_rabais ? " · " + echapper(v.motif_rabais) : ""}</span>` : ""].join(" ") },
        { titre: "Client", rendu: (v) => `${echapper(v.client_nom || "De passage")} <span class="discret">${echapper(TYPES_CLIENT[v.type_client] || "")}</span>` },
        { titre: "Vendeur", rendu: (v) => echapper(v.vendeur || "—") },
        { titre: "Total", classe: "droite", rendu: (v) => `<strong>${fmt(v.total)}</strong>` },
      ], { vide: "Aucune vente ce mois-ci.", actions: () => `<button class="btn petit" data-action="annuler" title="Annuler la vente">Annuler</button>`,
        pied: `<td colspan="6">Total</td><td class="droite">${fmt(total)}</td><td></td>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    annuler: async (v) => {
      if (!(await confirmer(`Annuler la vente n°${v.id} (${fmt(v.total)}) ? La recette sera retirée de la compta.`, "Annuler la vente"))) return;
      await rpc("annuler_vente", { p_id: v.id }); toast("Vente annulée."); charger();
    },
  });
  await charger();
}

// --- Recettes ------------------------------------------------------------------------------------------------
async function recettes(zone) {
  const { debut, fin } = bornesMois(mois);
  let lignes = [], noms = {};
  const champs = async () => [
    { nom: "montant", libelle: "Montant ($)", type: "argent", requis: true },
    { nom: "date", libelle: "Date", type: "date", defaut: new Date().toISOString() },
    { nom: "client_id", libelle: "Client enregistré", type: "choix", entier: true, options: [["", "— Aucun —"], ...(await clients()).map((c) => [c.id, c.nom])] },
    { nom: "type_client", libelle: "Type de client", type: "choix", options: options(TYPES_CLIENT), aide: "Ignoré si un client enregistré est choisi." },
    { nom: "description", libelle: "Description", plein: true, requis: true },
  ];
  const charger = async () => {
    [lignes, noms] = await Promise.all([q(table("recettes").select("*").gte("date", debut).lt("date", fin).order("date", { ascending: false })), nomsClients()]);
    const total = lignes.reduce((s, r) => s + r.montant, 0);
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">💰 Recettes — ${fmt(total)}</h2><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Ajouter une recette</button></div>
      ${tableau(lignes, [
        { titre: "Date", rendu: (r) => dateCourte(r.date, true) },
        { titre: "Description", rendu: (r) => echapper(r.description || "") + (r.vente_id ? ' <span class="badge">caisse</span>' : r.facture_id ? ' <span class="badge">facture</span>' : "") },
        { titre: "Client", rendu: (r) => `${echapper(noms[r.client_id] || "")} <span class="discret">${echapper(TYPES_CLIENT[r.type_client] || r.type_client)}</span>` },
        { titre: "Montant", classe: "droite", rendu: (r) => `<strong>${fmt(r.montant)}</strong>` },
      ], { vide: "Aucune recette ce mois-ci.", actions: (r) => r.vente_id ? "" : `<button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>`,
        pied: `<td colspan="3">Total</td><td class="droite">${fmt(total)}</td><td></td>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    ajouter: async () => formulaireEnFenetre("Nouvelle recette", await champs(), { type_client: "particulier" }, async (o) => {
      if (o.client_id) o.type_client = (await clients()).find((c) => c.id === o.client_id)?.type || o.type_client;
      if (!o.montant) throw new Error("Le montant doit être supérieur à 0.");
      await q(table("recettes").insert({ ...o, date: o.date || new Date().toISOString() })); toast("Recette enregistrée."); charger();
    }),
    supprimer: async (r) => {
      const msg = r.facture_id ? "Supprimer cette recette ? La facture liée redeviendra « impayée »." : "Supprimer cette recette ?";
      if (!(await confirmer(msg, "Supprimer"))) return;
      await q(table("recettes").delete().eq("id", r.id)); toast("Recette supprimée."); charger();
    },
  });
  await charger();
}

// --- Dépenses -----------------------------------------------------------------------------------------------
async function depenses(zone) {
  const { debut, fin } = bornesMois(mois);
  let lignes = [];
  const champs = [
    { nom: "montant", libelle: "Montant ($)", type: "argent", requis: true },
    { nom: "date", libelle: "Date", type: "date", defaut: new Date().toISOString() },
    { nom: "categorie", libelle: "Catégorie", type: "choix", options: options(CATEGORIES_DEPENSE), requis: true, plein: true,
      aide: "Déductibles : matières premières, services, essence, fournitures. « Autre » : seulement après validation de la Mairie." },
    { nom: "fournisseur", libelle: "Fournisseur", requis: true },
    { nom: "description", libelle: "Détail" },
    { nom: "justificatif", libelle: "Justificatif (lien de la capture)", plein: true, max: 500 },
    { nom: "validee_mairie", libelle: "Validée par la Mairie (catégorie « Autre »)", type: "case" },
    { nom: "ref_validation", libelle: "Référence de validation Mairie" },
  ];
  const etat = (d) => d.categorie === "non_deductible" ? '<span class="badge rouge">non déductible</span>'
    : d.categorie === "autre" && !d.validee_mairie ? '<span class="badge orange">attente Mairie</span>' : '<span class="badge vert">déductible</span>';
  const charger = async () => {
    lignes = await q(table("depenses").select("*").gte("date", debut).lt("date", fin).order("date", { ascending: false }));
    const total = lignes.reduce((s, d) => s + d.montant, 0);
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📉 Dépenses — ${fmt(total)}</h2><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Ajouter une dépense</button></div>
      ${tableau(lignes, [
        { titre: "Date", rendu: (d) => dateCourte(d.date) },
        { titre: "Catégorie", rendu: (d) => `${echapper(CATEGORIES_DEPENSE[d.categorie]?.split(" (")[0].split(" —")[0] || d.categorie)} ${etat(d)}` },
        { titre: "Fournisseur", rendu: (d) => echapper(d.fournisseur || "") + (d.description ? `<div class="discret">${echapper(d.description)}</div>` : "") },
        { titre: "Justificatif", rendu: (d) => d.justificatif ? (/^https?:\/\//.test(d.justificatif) ? `<a href="${echapper(d.justificatif)}" target="_blank" rel="noopener">voir</a>` : echapper(d.justificatif)) : "" },
        { titre: "Montant", classe: "droite", rendu: (d) => `<strong>${fmt(d.montant)}</strong>` },
      ], { vide: "Aucune dépense ce mois-ci.", actions: (d) => (d.categorie === "autre" && !d.validee_mairie ? `<button class="btn petit vert" data-action="valider">Validée Mairie</button> ` : "")
        + `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button> <button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>`,
        pied: `<td colspan="4">Total</td><td class="droite">${fmt(total)}</td><td></td>` })}</div>`;
  };
  const enregistrer = (id) => async (o) => {
    if (!o.montant) throw new Error("Le montant doit être supérieur à 0.");
    if (o.categorie === "autre" && !o.justificatif) throw new Error("Une dépense « Autre » doit avoir un justificatif (Art. III).");
    if (o.categorie !== "autre") o.validee_mairie = false;
    o.date = o.date || new Date().toISOString();
    await q(id ? table("depenses").update(o).eq("id", id) : table("depenses").insert(o));
    toast("Dépense enregistrée."); charger();
  };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouvelle dépense", champs, { categorie: "matieres_premieres" }, enregistrer(null)),
    modifier: (d) => formulaireEnFenetre("Modifier la dépense", champs, d, enregistrer(d.id)),
    valider: async (d) => { await q(table("depenses").update({ validee_mairie: true }).eq("id", d.id)); toast("Validée : elle est maintenant déductible."); charger(); },
    supprimer: async (d) => { if (await confirmer(`Supprimer la dépense de ${fmt(d.montant)} ?`, "Supprimer")) { await q(table("depenses").delete().eq("id", d.id)); toast("Dépense supprimée."); charger(); } },
  });
  await charger();
}

// --- Dons ---------------------------------------------------------------------------------------------------
async function dons(zone) {
  const { debut, fin } = bornesMois(mois);
  const reglages = await q(table("reglages").select("plafond_dons, periode_dons").eq("id", 1).single());
  let lignes = [];
  const champs = [
    { nom: "montant", libelle: "Valeur du don ($)", type: "argent", requis: true },
    { nom: "date", libelle: "Date", type: "date", defaut: new Date().toISOString() },
    { nom: "beneficiaire", libelle: "Structure bénéficiaire", requis: true },
    { nom: "type_beneficiaire", libelle: "Type", type: "choix", options: options(BENEFICIAIRES) },
    { nom: "nature", libelle: "Nature", type: "choix", options: options(NATURES_DON) },
    { nom: "description", libelle: "Détail" },
  ];
  const charger = async () => {
    lignes = await q(table("dons").select("*").gte("date", debut).lt("date", fin).order("date", { ascending: false }));
    const total = lignes.reduce((s, d) => s + d.montant, 0);
    const periode = { mois: "par mois", annee: "par an", don: "par don" }[reglages.periode_dons];
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🤝 Dons — ${fmt(total)}</h2>
      <span class="discret">plafond ${fmt(reglages.plafond_dons * 100)} ${periode}</span><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Ajouter un don</button></div>
      ${tableau(lignes, [
        { titre: "Date", rendu: (d) => dateCourte(d.date) },
        { titre: "Bénéficiaire", rendu: (d) => `${echapper(d.beneficiaire)} <span class="discret">${echapper(BENEFICIAIRES[d.type_beneficiaire])}</span>` },
        { titre: "Nature", rendu: (d) => echapper(NATURES_DON[d.nature]) + (d.description ? `<div class="discret">${echapper(d.description)}</div>` : "") },
        { titre: "Montant", classe: "droite", rendu: (d) => `<strong>${fmt(d.montant)}</strong>` },
      ], { vide: "Aucun don ce mois-ci.", actions: () => `<button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouveau don", champs, { type_beneficiaire: "association", nature: "monetaire" }, async (o) => {
      if (!o.montant) throw new Error("Le montant doit être supérieur à 0.");
      await q(table("dons").insert({ ...o, date: o.date || new Date().toISOString() })); toast("Don enregistré."); charger();
    }),
    supprimer: async (d) => { if (await confirmer(`Supprimer le don à ${d.beneficiaire} ?`, "Supprimer")) { await q(table("dons").delete().eq("id", d.id)); charger(); } },
  });
  await charger();
}

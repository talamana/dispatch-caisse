// Versions imprimables (et enregistrables en PDF) : devis, factures, déclaration mensuelle.
import { q, rpc, table } from "../api.js";
import { CATEGORIES_DEPENSE, dateFr, echapper, fmt, libelleMois, pourcent, TYPES_CLIENT } from "../outils.js";

function entete(r, titre, infos) {
  return `<div class="entete-doc"><div class="societe"><strong>${echapper(r.entreprise)}</strong><div class="petit">Micro-entreprise — San Andreas</div>
    ${(r.telephones || []).length ? `<div class="petit">Tél. ${echapper(r.telephones.join(" / "))}</div>` : ""}</div>
    <div style="text-align:right"><h1>${titre}</h1>${infos.map((i) => `<div>${i}</div>`).join("")}</div></div>`;
}

export async function afficher(vue, params) {
  const [genre, id] = params;
  const r = await q(table("reglages").select("*").eq("id", 1).single());
  let html = "";
  if (genre === "document") {
    const d = await q(table("documents").select("*").eq("id", Number(id)).single());
    const c = d.client_id ? await q(table("clients").select("*").eq("id", d.client_id).single()) : null;
    const devis = d.kind === "devis";
    document.title = `${devis ? "Devis" : "Facture"} ${d.numero}`;
    const infos = [`N° <strong>${echapper(d.numero)}</strong>`, `Date : ${dateFr(d.date)}`];
    if (d.echeance) infos.push(`${devis ? "Valable jusqu'au" : "Échéance"} : ${dateFr(d.echeance)}`);
    const mention = devis ? "Bon pour accord — date et signature du client :"
      : d.statut === "payee" ? `Facture réglée le ${dateFr(d.payee_le)}.` : d.statut === "annulee" ? "Facture annulée." : "Paiement à réception, auprès du gérant.";
    html = `${entete(r, devis ? "DEVIS" : "FACTURE", infos)}
      <div class="cadre"><div class="petit">CLIENT</div><strong>${echapper(c?.nom || "—")}</strong>${c ? `<div>${echapper(TYPES_CLIENT[c.type] || "")}</div>` : ""}${c?.telephone ? `<div>Tél. ${echapper(c.telephone)}</div>` : ""}</div>
      <table><thead><tr><th>Description</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Total</th></tr></thead>
      <tbody>${d.lignes.map((l) => `<tr><td>${echapper(l.description)}</td><td class="num">${String(l.quantite).replace(".", ",")}</td><td class="num">${fmt(l.prix_unitaire)}</td><td class="num">${fmt(l.total)}</td></tr>`).join("")}
      <tr class="total-doc"><td colspan="3" class="num">TOTAL</td><td class="num">${fmt(d.total)}</td></tr></tbody></table>
      ${d.note ? `<p style="margin-top:24px"><span class="petit">NOTE</span><br>${echapper(d.note)}</p>` : ""}
      <p style="margin-top:36px">${mention}</p>${devis ? '<div style="height:70px"></div>' : ""}`;
  } else if (genre === "declaration") {
    const b = await rpc("bilan", { p_mois: id });
    document.title = `Déclaration ${id}`;
    const l = (t, m, g) => `<tr><td>${g ? `<strong>${t}</strong>` : t}</td><td class="num">${g ? `<strong>${m}</strong>` : m}</td></tr>`;
    const s = (t) => `<tr class="section"><td colspan="2">${t}</td></tr>`;
    html = `${entete(r, "DÉCLARATION", [`Période : <strong>${libelleMois(id)}</strong>`, `À déposer avant le ${dateFr(b.limite_declaration)}`, "Mairie de Los Santos"])}
      <p><strong>Déclaration mensuelle de comptabilité — Art. III (Micro-entreprise)</strong></p>
      <table>${s("CHIFFRE D'AFFAIRES")}${Object.entries(b.ca_par_type).map(([k, v]) => l(`Recettes — ${TYPES_CLIENT[k] || k}`, fmt(v))).join("")}${l("Total chiffre d'affaires", fmt(b.ca), true)}
      ${s("DÉPENSES DÉDUCTIBLES")}${Object.entries(b.deductibles_par_categorie).map(([k, v]) => l(CATEGORIES_DEPENSE[k] || k, fmt(v))).join("")}${l("Total dépenses déductibles", fmt(b.depenses_deductibles), true)}
      ${s("IMPOSITION")}${l("Bénéfice imposable (CA − dépenses déductibles)", fmt(b.benefice), true)}${l(r.mode_impot === "tranches" ? "Taux effectif" : "Taux applicable", pourcent(b.taux))}${l("Impôt dû", fmt(b.impot), true)}
      ${s("APRÈS IMPÔT (NON DÉDUCTIBLE)")}${l("Rémunération des intérimaires", fmt(b.paies))}${l("Parts patronales", fmt(b.parts_patronales))}
      ${l("Dépenses non déductibles", fmt(b.depenses_non_deductibles + b.depenses_en_attente))}${l("Dons", fmt(b.dons))}${l("Résultat net", fmt(b.resultat_net), true)}</table>
      <p style="margin-top:20px">${b.declaration ? `Déclarée et réglée auprès de la Mairie le ${dateFr(b.declaration.declaree_le, true)}.` : "Statut : à déclarer et à régler auprès de la Mairie."}</p>
      <p style="margin-top:30px">Signature du gérant :</p><div style="height:60px"></div>`;
  } else {
    html = "<p>Document inconnu.</p>";
  }
  vue.innerHTML = `<div class="barre-impression"><button class="btn" onclick="history.back()">← Retour</button>
    <button class="btn principal" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button></div><div class="feuille">${html}
    <p class="petit" style="margin-top:30px">Document généré par ${echapper(r.entreprise)} le ${dateFr(new Date().toISOString(), true)}.</p></div>`;
}

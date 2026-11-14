// Tableau de bord : le mois en cours en un coup d'œil.
import { rpc, q, table } from "../api.js";
import { CATEGORIES_DEPENSE, dateFr, echapper, fmt, libelleMois, pourcent, TYPES_CLIENT } from "../outils.js";

function seuil(benefice, reglages) {
  const tranches = reglages?.tranches || [[50000, 0], [150000, 0.2], [null, 0.3]];
  const b = Math.max(benefice, 0);
  for (let i = 0; i < tranches.length; i++) {
    const [plafond, taux] = tranches[i];
    if (plafond === null) return `<p>Tranche maximale atteinte (${pourcent(taux)}).</p>`;
    if (b <= plafond * 100) {
      const suivant = tranches[i + 1]?.[1] ?? taux;
      return `<div class="jauge"><div style="width:${Math.min(100, (b / (plafond * 100)) * 100)}%"></div></div>
        <p class="discret" style="margin:8px 0 0">${fmt(b)} / ${fmt(plafond * 100)} — encore <strong>${fmt(plafond * 100 - b)}</strong>
        de bénéfice avant de passer à ${pourcent(suivant)} (actuellement ${pourcent(taux)}).</p>`;
    }
  }
  return "";
}

export async function afficher(vue) {
  const [t, reglages] = await Promise.all([rpc("tableau_de_bord"), q(table("reglages").select("*").eq("id", 1).single())]);
  const m = t.mois, dp = t.declaration_precedente;
  const alertes = [];
  if (dp.faite) alertes.push(`✅ Déclaration de ${libelleMois(dp.mois)} faite.`);
  else if (dp.activite) alertes.push(`${dp.en_retard ? "⚠️ <strong>En retard</strong> —" : "🏛️"} Déclaration de ${libelleMois(dp.mois)} à faire avant le <strong>${dateFr(dp.limite)}</strong> (impôt : ${fmt(dp.impot)}) <a href="#/compta/bilan">Déclarer →</a>`);
  if (t.factures.n) alertes.push(`🧾 ${t.factures.n} facture(s) à encaisser : <strong>${fmt(t.factures.total)}</strong>${t.factures.en_retard ? ` · <span class="rouge">${t.factures.en_retard} en retard</span>` : ""} <a href="#/factures">Voir →</a>`);
  if (t.devis.acceptes) alertes.push(`📝 ${t.devis.acceptes} devis accepté(s) à facturer (${fmt(t.devis.total_acceptes)}) <a href="#/factures/devis">Voir →</a>`);
  if (t.paies_dues.n) alertes.push(`💳 ${t.paies_dues.n} paie(s) d'intérimaire à verser : <strong>${fmt(t.paies_dues.total)}</strong> — le compte du gérant doit les couvrir (Art. III) <a href="#/interim/paies">Voir →</a>`);
  if (t.depenses_mairie) alertes.push(`⏳ ${t.depenses_mairie} dépense(s) « autre » en attente de validation Mairie <a href="#/compta/depenses">Voir →</a>`);
  if (t.taches_en_retard) alertes.push(`📌 ${t.taches_en_retard} tâche(s) en retard <a href="#/organisation">Voir →</a>`);

  const deps = Object.entries(m.deductibles_par_categorie || {}).map(([k, v]) => `<li>${echapper(CATEGORIES_DEPENSE[k] || k)} <span class="discret" style="margin-left:auto">${fmt(v)}</span></li>`).join("");
  const ca = Object.entries(m.ca_par_type || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li>${echapper(TYPES_CLIENT[k] || k)} <span class="discret" style="margin-left:auto">${fmt(v)}</span></li>`).join("");

  vue.innerHTML = `<div class="page">
    <div class="titre-page"><h1>${echapper(libelleMois(m.mois))}</h1><span class="badge">mois en cours</span><span class="espace"></span>
      <a class="btn principal" href="#/caisse">🍔 Caisse</a></div>
    <div class="kpis">
      <div class="kpi"><div class="etiquette">Chiffre d'affaires</div><div class="valeur">${fmt(m.ca)}</div><div class="sous">Ventes du jour : ${fmt(t.ventes_jour.total)} (${t.ventes_jour.n})</div></div>
      <div class="kpi"><div class="etiquette">Bénéfice imposable</div><div class="valeur">${fmt(m.benefice)}</div><div class="sous">Dépenses déductibles : ${fmt(m.depenses_deductibles)}</div></div>
      <div class="kpi"><div class="etiquette">Impôt estimé</div><div class="valeur">${fmt(m.impot)}</div><div class="sous">Taux ${pourcent(m.taux)}</div></div>
      <div class="kpi accent"><div class="etiquette">Résultat net</div><div class="valeur">${fmt(m.resultat_net)}</div><div class="sous">après impôt, paies, parts, dons</div></div>
    </div>
    <div class="grille-2">
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📌 À suivre</h2></div>
        ${alertes.length ? `<ul class="alertes">${alertes.map((a) => `<li>${a}</li>`).join("")}</ul>` : `<div class="vide">Rien en attente 🎉</div>`}</div>
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📈 Seuil d'imposition</h2></div>${seuil(m.benefice, reglages)}
        <div class="grille-2" style="margin-top:14px">
          <div><div class="etiquette">Recettes par type</div><ul class="alertes">${ca || '<li class="discret">Aucune</li>'}</ul></div>
          <div><div class="etiquette">Dépenses déductibles</div><ul class="alertes">${deps || '<li class="discret">Aucune</li>'}</ul></div>
        </div></div>
    </div>
    <div class="grille-2">
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">➖ Après impôt (non déductible)</h2></div>
        <ul class="alertes"><li>Paies d'intérimaires <span style="margin-left:auto">${fmt(m.paies)}</span></li>
        <li>Parts patronales <span style="margin-left:auto">${fmt(m.parts_patronales)}</span></li>
        <li>Dépenses non déductibles / en attente Mairie <span style="margin-left:auto">${fmt(m.depenses_non_deductibles + m.depenses_en_attente)}</span></li>
        <li>Dons <span style="margin-left:auto">${fmt(m.dons)}</span></li></ul></div>
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📅 Prochains rendez-vous</h2><span class="espace"></span><a class="lien" href="#/organisation">Agenda</a></div>
        ${t.rdv_a_venir.length ? `<ul class="alertes">${t.rdv_a_venir.map((r) => `<li><strong>${dateFr(r.quand, true)}</strong> ${echapper(r.titre)}${r.client ? ` · ${echapper(r.client)}` : ""}${r.lieu ? ` · 📍 ${echapper(r.lieu)}` : ""}</li>`).join("")}</ul>` : `<div class="vide">Rien de prévu.</div>`}</div>
    </div></div>`;
}

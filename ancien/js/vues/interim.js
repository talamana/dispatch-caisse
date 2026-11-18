// Intérim (Art. III) : collaborateurs payés à la mission, paies, parts patronales.
import { clients, nomsClients, q, rpc, table } from "../api.js";
import {
  $, $$, bornesMois, brancherActions, confirmer, dateCourte, echapper, fenetre, fmt, formulaireEnFenetre, libelleMois, moisCourant,
  tableau, toast, versCentimes,
} from "../outils.js";

const ONGLETS = [["missions", "Missions"], ["collaborateurs", "Collaborateurs"], ["paies", "Paies"], ["parts", "Parts patronales"]];
const AVERTISSEMENT = "⚠️ A un contrat dans une autre structure : il doit être hors service de son autre emploi pendant la mission (Art. III).";

export async function afficher(vue, params) {
  const onglet = ONGLETS.some(([k]) => k === params[0]) ? params[0] : "missions";
  vue.innerHTML = `<div class="page"><div class="titre-page"><h1>Intérim</h1></div>
    <div class="onglets-page">${ONGLETS.map(([k, v]) => `<button data-onglet="${k}" aria-selected="${k === onglet}">${v}</button>`).join("")}</div>
    <div id="contenu"></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/interim/${b.dataset.onglet}`; }));
  await ({ missions, collaborateurs, paies, parts })[onglet]($("#contenu", vue));
}

// --- Missions -----------------------------------------------------------------------------------------
async function missions(zone) {
  let lignes = [], collabs = [], affectes = [], noms = {};
  const charger = async () => {
    [lignes, collabs, affectes, noms] = await Promise.all([
      q(table("missions").select("*").order("date", { ascending: false }).limit(100)),
      q(table("collaborateurs").select("*").order("nom")), q(table("mission_collabs").select("*")), nomsClients()]);
    const parId = Object.fromEntries(collabs.map((c) => [c.id, c]));
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📋 Missions</h2><span class="espace"></span>
      <button class="btn principal" data-action="nouvelle">+ Nouvelle mission</button></div>
      ${tableau(lignes, [
        { titre: "Date", rendu: (m) => dateCourte(m.date) },
        { titre: "Mission", rendu: (m) => `<strong>${echapper(m.titre)}</strong>${m.client_id ? `<div class="discret">${echapper(noms[m.client_id] || "")}</div>` : ""}${m.description ? `<div class="discret">${echapper(m.description)}</div>` : ""}` },
        { titre: "Collaborateurs", rendu: (m) => affectes.filter((a) => a.mission_id === m.id).map((a) => {
            const c = parId[a.collab_id]; if (!c) return "";
            return `<div>${echapper(c.nom)} — ${fmt(a.remuneration)}${c.contrat_ailleurs ? ' <span class="badge orange" title="' + echapper(AVERTISSEMENT) + '">hors service ailleurs</span>' : ""}${m.statut === "planifiee" ? ` <button class="lien" data-action="retirer" data-collab="${c.id}">retirer</button>` : ""}</div>`;
          }).join("") || '<span class="discret">Personne</span>' },
        { titre: "Paie de base", classe: "droite", rendu: (m) => fmt(m.remuneration) },
        { titre: "Statut", rendu: (m) => `<span class="badge ${{ planifiee: "orange", terminee: "vert", annulee: "" }[m.statut]}">${{ planifiee: "📅 Planifiée", terminee: "✅ Terminée", annulee: "🚫 Annulée" }[m.statut]}</span>` },
      ], { vide: "Aucune mission.", actions: (m) => m.statut !== "planifiee" ? "" :
        `<button class="btn petit" data-action="affecter">+ Collaborateur</button> <button class="btn petit vert" data-action="terminer">Terminer</button> <button class="btn petit icone" data-action="annuler" title="Annuler">🚫</button>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    nouvelle: async () => formulaireEnFenetre("Nouvelle mission", [
      { nom: "titre", libelle: "Intitulé", requis: true, plein: true },
      { nom: "date", libelle: "Date", type: "date", defaut: new Date().toISOString() },
      { nom: "remuneration", libelle: "Paie par collaborateur ($)", type: "argent", requis: true },
      { nom: "client_id", libelle: "Client", type: "choix", entier: true, options: [["", "— Aucun —"], ...(await clients()).map((c) => [c.id, c.nom])] },
      { nom: "description", libelle: "Détails", type: "zone" },
    ], {}, async (o) => { await q(table("missions").insert({ ...o, date: o.date || new Date().toISOString() })); toast("Mission créée."); charger(); }),
    affecter: async (m) => {
      const actifs = collabs.filter((c) => c.actif && !affectes.some((a) => a.mission_id === m.id && a.collab_id === c.id));
      if (!actifs.length) { toast("Aucun collaborateur disponible : ajoute-en dans l'onglet Collaborateurs.", true); return; }
      await formulaireEnFenetre(`Affecter à « ${m.titre} »`, [
        { nom: "collab_id", libelle: "Collaborateur", type: "choix", entier: true, requis: true, options: actifs.map((c) => [c.id, c.nom + (c.contrat_ailleurs ? " (contrat ailleurs)" : "")]) },
        { nom: "remuneration", libelle: "Paie ($)", type: "argent", defaut: m.remuneration, requis: true },
      ], {}, async (o) => {
        await q(table("mission_collabs").insert({ mission_id: m.id, collab_id: o.collab_id, remuneration: o.remuneration }));
        const c = collabs.find((x) => x.id === o.collab_id);
        toast(c?.contrat_ailleurs ? `${c.nom} affecté. ${AVERTISSEMENT}` : "Collaborateur affecté.", !!c?.contrat_ailleurs);
        charger();
      });
    },
    retirer: async (m, b) => { await q(table("mission_collabs").delete().eq("mission_id", m.id).eq("collab_id", Number(b.dataset.collab))); charger(); },
    terminer: async (m) => {
      const total = affectes.filter((a) => a.mission_id === m.id).reduce((s, a) => s + a.remuneration, 0);
      if (!(await confirmer(`Clôturer « ${m.titre} » ? ${total ? `${fmt(total)} de paies deviennent dues : le compte du gérant doit disposer de ces fonds (Art. III).` : "Personne n'était affecté."}`, "Terminer la mission"))) return;
      const n = await rpc("terminer_mission", { p_id: m.id }); toast(`Mission terminée : ${n} paie(s) à verser.`); charger();
    },
    annuler: async (m) => { if (await confirmer(`Annuler la mission « ${m.titre} » ?`, "Annuler la mission")) { await q(table("missions").update({ statut: "annulee" }).eq("id", m.id)); charger(); } },
  });
  await charger();
}

// --- Collaborateurs ---------------------------------------------------------------------------------------
async function collaborateurs(zone) {
  let lignes = [], dues = [];
  const champs = [
    { nom: "nom", libelle: "Nom RP", requis: true },
    { nom: "discord", libelle: "Pseudo Discord" },
    { nom: "contrat_ailleurs", libelle: "A un contrat dans une autre structure", type: "case", plein: true },
    { nom: "actif", libelle: "Actif", type: "case", plein: true },
  ];
  const charger = async () => {
    [lignes, dues] = await Promise.all([q(table("collaborateurs").select("*").order("actif", { ascending: false }).order("nom")), q(table("paies").select("collab_id, montant").eq("payee", false))]);
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🧑‍🔧 Collaborateurs</h2><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Ajouter</button></div>
      ${tableau(lignes, [
        { titre: "Nom", rendu: (c) => `<strong>${echapper(c.nom)}</strong>${c.discord ? ` <span class="discret">@${echapper(c.discord)}</span>` : ""}` },
        { titre: "Contrat ailleurs", rendu: (c) => c.contrat_ailleurs ? `<span class="badge orange" title="${echapper(AVERTISSEMENT)}">oui — hors service pendant les missions</span>` : '<span class="discret">non</span>' },
        { titre: "Reste dû", classe: "droite", rendu: (c) => { const d = dues.filter((p) => p.collab_id === c.id).reduce((s, p) => s + p.montant, 0); return d ? `<span class="badge orange">${fmt(d)}</span>` : '<span class="discret">—</span>'; } },
        { titre: "État", rendu: (c) => c.actif ? '<span class="badge vert">actif</span>' : '<span class="badge">retiré</span>' },
      ], { vide: "Aucun collaborateur.", actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button>` })}</div>`;
  };
  const enregistrer = (id) => async (o) => { await q(id ? table("collaborateurs").update(o).eq("id", id) : table("collaborateurs").insert(o)); toast("Enregistré."); charger(); };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouveau collaborateur", champs, { actif: true }, enregistrer(null)),
    modifier: (c) => formulaireEnFenetre(`Modifier ${c.nom}`, champs, c, enregistrer(c.id)),
  });
  await charger();
}

// --- Paies ---------------------------------------------------------------------------------------------------
async function paies(zone) {
  let dues = [], collabs = {}, missionsParId = {};
  const charger = async () => {
    const { debut, fin } = bornesMois(moisCourant());
    const [d, c, m, versees] = await Promise.all([q(table("paies").select("*").eq("payee", false).order("date")),
      q(table("collaborateurs").select("id, nom")), q(table("missions").select("id, titre")),
      q(table("paies").select("montant").eq("payee", true).gte("payee_le", debut).lt("payee_le", fin))]);
    dues = d; collabs = Object.fromEntries(c.map((x) => [x.id, x.nom])); missionsParId = Object.fromEntries(m.map((x) => [x.id, x.titre]));
    const total = dues.reduce((s, p) => s + p.montant, 0);
    zone.innerHTML = `<div class="kpis"><div class="kpi accent"><div class="etiquette">Paies à verser</div><div class="valeur">${fmt(total)}</div><div class="sous">à couvrir par le compte du gérant</div></div>
      <div class="kpi"><div class="etiquette">Versé en ${libelleMois(moisCourant())}</div><div class="valeur">${fmt(versees.reduce((s, p) => s + p.montant, 0))}</div></div></div>
      <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">💳 Paies dues</h2></div>
      ${tableau(dues, [
        { titre: "Collaborateur", rendu: (p) => `<strong>${echapper(collabs[p.collab_id] || "?")}</strong>` },
        { titre: "Mission", rendu: (p) => echapper(missionsParId[p.mission_id] || "—") },
        { titre: "Date", rendu: (p) => dateCourte(p.date) },
        { titre: "Montant", classe: "droite", rendu: (p) => `<strong>${fmt(p.montant)}</strong>` },
      ], { vide: "Tout est à jour 🎉", actions: () => `<button class="btn petit vert" data-action="payer">Versée</button> <button class="btn petit" data-action="tout">Tout ce qui lui est dû</button>` })}</div>`;
  };
  brancherActions(zone, () => dues, {
    payer: async (p) => { await q(table("paies").update({ payee: true, payee_le: new Date().toISOString() }).eq("id", p.id)); toast(`${fmt(p.montant)} versés à ${collabs[p.collab_id]}.`); charger(); },
    tout: async (p) => {
      const total = dues.filter((x) => x.collab_id === p.collab_id).reduce((s, x) => s + x.montant, 0);
      if (!(await confirmer(`Marquer comme versées toutes les paies de ${collabs[p.collab_id]} (${fmt(total)}) ?`))) return;
      await q(table("paies").update({ payee: true, payee_le: new Date().toISOString() }).eq("collab_id", p.collab_id).eq("payee", false));
      toast("Paies soldées."); charger();
    },
  });
  await charger();
}

// --- Parts patronales -------------------------------------------------------------------------------------------
async function parts(zone) {
  let lignes = [];
  const charger = async () => {
    lignes = await q(table("parts_patronales").select("*").order("date", { ascending: false }).limit(100));
    const mois = moisCourant(), duMois = lignes.filter((p) => p.date.slice(0, 7) === mois || new Date(p.date).toISOString().slice(0, 7) === mois);
    const parGerant = {};
    duMois.forEach((p) => { parGerant[p.gerant || "—"] = (parGerant[p.gerant || "—"] || 0) + p.montant; });
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">👔 Parts patronales</h2>
      <span class="discret">non déductibles, après impôt</span><span class="espace"></span><button class="btn principal" data-action="ajouter">+ Ajouter</button></div>
      ${Object.keys(parGerant).length ? `<p>${libelleMois(mois)} : ${Object.entries(parGerant).map(([g, m]) => `<span class="badge">${echapper(g)} · ${fmt(m)}</span>`).join(" ")}</p>` : ""}
      ${tableau(lignes, [
        { titre: "Date", rendu: (p) => dateCourte(p.date) },
        { titre: "Gérant", rendu: (p) => `<strong>${echapper(p.gerant || "—")}</strong>` },
        { titre: "Note", rendu: (p) => echapper(p.note || "") },
        { titre: "Montant", classe: "droite", rendu: (p) => `<strong>${fmt(p.montant)}</strong>` },
      ], { vide: "Aucune part patronale.", actions: () => `<button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Part patronale", [
      { nom: "montant", libelle: "Montant ($)", type: "argent", requis: true },
      { nom: "date", libelle: "Date", type: "date", defaut: new Date().toISOString() },
      { nom: "gerant", libelle: "Gérant qui la reçoit", requis: true },
      { nom: "note", libelle: "Note" },
    ], {}, async (o) => { if (!o.montant) throw new Error("Le montant doit être supérieur à 0."); await q(table("parts_patronales").insert({ ...o, date: o.date || new Date().toISOString() })); toast("Part patronale enregistrée."); charger(); }),
    supprimer: async (p) => { if (await confirmer(`Supprimer la part de ${fmt(p.montant)} ?`, "Supprimer")) { await q(table("parts_patronales").delete().eq("id", p.id)); charger(); } },
  });
  await charger();
}

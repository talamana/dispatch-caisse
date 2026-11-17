// Tâches de l'équipe et agenda des rendez-vous.
import { clients, nomsClients, q, table } from "../api.js";
import { brancherActions, confirmer, dateFr, echapper, formulaireEnFenetre, tableau, toast } from "../outils.js";

export async function afficher(vue) {
  vue.innerHTML = `<div class="page"><div class="titre-page"><h1>Tâches & agenda</h1></div>
    <div class="grille-2"><div id="taches"></div><div id="agenda"></div></div></div>`;
  await Promise.all([taches(vue.querySelector("#taches")), agenda(vue.querySelector("#agenda"))]);
}

async function taches(zone) {
  let lignes = [], voirFinies = false;
  const champs = [
    { nom: "titre", libelle: "À faire", requis: true, plein: true },
    { nom: "assigne", libelle: "Qui s'en occupe" },
    { nom: "echeance", libelle: "Pour quand", type: "dateheure" },
  ];
  const charger = async () => {
    let r = table("taches").select("*").order("statut").order("echeance").order("id");
    if (!voirFinies) r = r.eq("statut", "ouverte");
    lignes = await q(r);
    const maintenant = new Date();
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📌 Tâches</h2><span class="espace"></span>
      <button class="lien" data-action="basculer">${voirFinies ? "Masquer les terminées" : "Voir les terminées"}</button>
      <button class="btn principal" data-action="ajouter">+ Tâche</button></div>
      ${tableau(lignes, [
        { titre: "", rendu: (t) => `<input type="checkbox" data-action="cocher" ${t.statut === "terminee" ? "checked" : ""} aria-label="Terminée" style="width:18px;height:18px;accent-color:#e8212b">` },
        { titre: "Tâche", rendu: (t) => `<span style="${t.statut === "terminee" ? "text-decoration:line-through;opacity:.6" : ""}">${echapper(t.titre)}</span>${t.assigne ? `<div class="discret">👤 ${echapper(t.assigne)}</div>` : ""}` },
        { titre: "Échéance", rendu: (t) => t.echeance ? `<span class="${t.statut === "ouverte" && new Date(t.echeance) < maintenant ? "rouge" : ""}">${dateFr(t.echeance, true)}</span>` : '<span class="discret">—</span>' },
      ], { vide: "Aucune tâche en cours 🎉", actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button> <button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>` })}</div>`;
  };
  const enregistrer = (id) => async (o) => { await q(id ? table("taches").update(o).eq("id", id) : table("taches").insert(o)); toast("Tâche enregistrée."); charger(); };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouvelle tâche", champs, {}, enregistrer(null)),
    modifier: (t) => formulaireEnFenetre("Modifier la tâche", champs, t, enregistrer(t.id)),
    cocher: async (t) => { await q(table("taches").update({ statut: t.statut === "ouverte" ? "terminee" : "ouverte" }).eq("id", t.id)); charger(); },
    supprimer: async (t) => { if (await confirmer(`Supprimer « ${t.titre} » ?`, "Supprimer")) { await q(table("taches").delete().eq("id", t.id)); charger(); } },
    basculer: async () => { voirFinies = !voirFinies; charger(); },
  });
  await charger();
}

async function agenda(zone) {
  let lignes = [], noms = {}, voirPasses = false;
  const champs = async () => [
    { nom: "titre", libelle: "Objet", requis: true, plein: true },
    { nom: "quand", libelle: "Date et heure", type: "dateheure", requis: true },
    { nom: "client_id", libelle: "Client", type: "choix", entier: true, options: [["", "— Aucun —"], ...(await clients()).map((c) => [c.id, c.nom])] },
    { nom: "lieu", libelle: "Lieu en jeu" },
    { nom: "note", libelle: "Note", type: "zone" },
  ];
  const charger = async () => {
    let r = table("rdv").select("*").order("quand");
    if (!voirPasses) r = r.eq("statut", "prevu").gte("quand", new Date(Date.now() - 3 * 3600e3).toISOString());
    [lignes, noms] = await Promise.all([q(r), nomsClients()]);
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">📅 Rendez-vous</h2><span class="espace"></span>
      <button class="lien" data-action="basculer">${voirPasses ? "À venir seulement" : "Tout l'historique"}</button>
      <button class="btn principal" data-action="ajouter">+ Rendez-vous</button></div>
      ${tableau(lignes, [
        { titre: "Quand", rendu: (r) => `<strong class="nowrap">${dateFr(r.quand, true)}</strong>` },
        { titre: "Rendez-vous", rendu: (r) => `${echapper(r.titre)}${r.client_id ? `<div class="discret">👤 ${echapper(noms[r.client_id] || "")}</div>` : ""}${r.lieu ? `<div class="discret">📍 ${echapper(r.lieu)}</div>` : ""}${r.note ? `<div class="discret">${echapper(r.note)}</div>` : ""}` },
        { titre: "", rendu: (r) => r.statut === "prevu" ? "" : `<span class="badge">${r.statut === "fait" ? "fait" : "annulé"}</span>` },
      ], { vide: "Rien de prévu.", actions: (r) => r.statut !== "prevu" ? `<button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>`
        : `<button class="btn petit" data-action="fait">Fait</button> <button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button> <button class="btn petit icone" data-action="annuler" title="Annuler">🚫</button>` })}</div>`;
  };
  const enregistrer = (id) => async (o) => { await q(id ? table("rdv").update(o).eq("id", id) : table("rdv").insert(o)); toast("Rendez-vous enregistré."); charger(); };
  brancherActions(zone, () => lignes, {
    ajouter: async () => formulaireEnFenetre("Nouveau rendez-vous", await champs(), {}, enregistrer(null)),
    modifier: async (r) => formulaireEnFenetre("Modifier le rendez-vous", await champs(), r, enregistrer(r.id)),
    fait: async (r) => { await q(table("rdv").update({ statut: "fait" }).eq("id", r.id)); charger(); },
    annuler: async (r) => { if (await confirmer(`Annuler « ${r.titre} » ?`, "Annuler le rendez-vous")) { await q(table("rdv").update({ statut: "annule" }).eq("id", r.id)); charger(); } },
    supprimer: async (r) => { await q(table("rdv").delete().eq("id", r.id)); charger(); },
    basculer: async () => { voirPasses = !voirPasses; charger(); },
  });
  await charger();
}

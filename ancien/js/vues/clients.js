// Clients : fiches, chiffre d'affaires, factures en attente.
import { oublierClients, q, table } from "../api.js";
import { brancherActions, confirmer, echapper, fmt, formulaireEnFenetre, options, tableau, toast, TYPES_CLIENT } from "../outils.js";

const CHAMPS = [
  { nom: "nom", libelle: "Nom", requis: true },
  { nom: "type", libelle: "Type", type: "choix", options: options(TYPES_CLIENT) },
  { nom: "telephone", libelle: "Téléphone (en jeu)" },
  { nom: "note", libelle: "Note", type: "zone" },
];

export async function afficher(vue) {
  vue.innerHTML = `<div class="page"><div class="titre-page"><h1>Clients</h1><span class="espace"></span>
    <input class="champ" id="recherche" placeholder="Rechercher…" style="max-width:240px">
    <button class="btn principal" data-action="ajouter">+ Nouveau client</button></div><div id="liste"></div></div>`;
  const page = vue.querySelector(".page");
  let lignes = [], tous = [];
  const dessiner = () => {
    const filtre = vue.querySelector("#recherche").value.trim().toLowerCase();
    lignes = tous.filter((c) => !filtre || c.nom.toLowerCase().includes(filtre));
    const du = tous.reduce((s, c) => s + c.du, 0);
    vue.querySelector("#liste").innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">${tous.length} client(s)</h2>
      <span class="espace"></span>${du ? `<span class="badge orange">${fmt(du)} à encaisser</span>` : '<span class="badge vert">Tout est encaissé</span>'}</div>
      ${tableau(lignes, [
        { titre: "Client", rendu: (c) => `<strong>${echapper(c.nom)}</strong>${c.note ? `<div class="discret">${echapper(c.note)}</div>` : ""}` },
        { titre: "Type", rendu: (c) => echapper(TYPES_CLIENT[c.type] || c.type) },
        { titre: "Téléphone", rendu: (c) => echapper(c.telephone || "") },
        { titre: "CA total", classe: "droite", rendu: (c) => fmt(c.ca) },
        { titre: "À encaisser", classe: "droite", rendu: (c) => c.du ? `<a href="#/factures"><span class="badge orange">${fmt(c.du)} · ${c.n_du} fact.</span></a>` : '<span class="discret">—</span>' },
      ], { vide: "Aucun client. Ajoute-en un, ou ils seront créés au fil des factures.",
        actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button> <button class="btn petit icone" data-action="supprimer" title="Supprimer">🗑</button>` })}</div>`;
  };
  const charger = async () => {
    const [cl, recettes, factures] = await Promise.all([
      q(table("clients").select("*").order("nom")),
      q(table("recettes").select("client_id, montant").not("client_id", "is", null)),
      q(table("documents").select("client_id, total").eq("kind", "facture").eq("statut", "impayee")),
    ]);
    tous = cl.map((c) => ({ ...c, ca: recettes.filter((r) => r.client_id === c.id).reduce((s, r) => s + r.montant, 0),
      du: factures.filter((f) => f.client_id === c.id).reduce((s, f) => s + f.total, 0), n_du: factures.filter((f) => f.client_id === c.id).length }));
    tous.sort((a, b) => b.du - a.du || b.ca - a.ca || a.nom.localeCompare(b.nom));
    dessiner();
  };
  vue.querySelector("#recherche").addEventListener("input", dessiner);
  const enregistrer = (id) => async (o) => {
    await q(id ? table("clients").update(o).eq("id", id) : table("clients").insert(o));
    oublierClients(); toast("Client enregistré."); charger();
  };
  brancherActions(page, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouveau client", CHAMPS, { type: "particulier" }, enregistrer(null)),
    modifier: (c) => formulaireEnFenetre(`Modifier ${c.nom}`, CHAMPS, c, enregistrer(c.id)),
    supprimer: async (c) => {
      if (!(await confirmer(`Supprimer ${c.nom} ? Ses factures et recettes restent en compta, sans nom de client.`, "Supprimer"))) return;
      await q(table("clients").delete().eq("id", c.id)); oublierClients(); toast("Client supprimé."); charger();
    },
  });
  await charger();
}

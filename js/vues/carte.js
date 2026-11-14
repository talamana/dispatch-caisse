// Carte du restaurant (articles, tarifs) et réglages de l'entreprise (Art. III).
import { definirCode, q, table } from "../api.js";
import { $, $$, brancherActions, confirmer, echapper, fmt, formulaire, formulaireEnFenetre, lireFormulaire, tableau, toast } from "../outils.js";

export async function afficher(vue, params) {
  const onglet = ["tarifs", "ingredients", "reglages"].includes(params[0]) ? params[0] : "articles";
  vue.innerHTML = `<div class="page"><div class="titre-page"><h1>Carte & réglages</h1></div>
    <div class="onglets-page"><button data-onglet="articles" aria-selected="${onglet === "articles"}">Articles</button>
      <button data-onglet="tarifs" aria-selected="${onglet === "tarifs"}">Tarifs</button>
      <button data-onglet="ingredients" aria-selected="${onglet === "ingredients"}">Ingrédients</button>
      <button data-onglet="reglages" aria-selected="${onglet === "reglages"}">Réglages</button></div><div id="contenu"></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/carte/${b.dataset.onglet}`; }));
  await ({ articles, tarifs, ingredients, reglages })[onglet]($("#contenu", vue));
}

const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// composition [{recette, qte} | {nom, qte}] <-> texte « 2× Compote » (une ligne par plat)
function compositionEnTexte(compo, recettes) {
  const noms = new Map(recettes.map((r) => [r.id, r.nom]));
  return (compo || []).map((c) => `${(c.qte || 1) > 1 ? `${c.qte}× ` : ""}${c.recette ? noms.get(c.recette) || c.recette : c.nom}`).join("\n");
}
function texteEnComposition(texte, recettes) {
  const parNom = new Map(recettes.map((r) => [sansAccent(r.nom), r]));
  const inconnus = [];
  const compo = String(texte || "").split(/\n|,/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s*[x×*]\s*(.+)$/i);
    const qte = m ? Number(m[1]) : 1, nom = (m ? m[2] : l).trim();
    const r = parNom.get(sansAccent(nom));
    if (!r) inconnus.push(nom);
    return r ? { recette: r.id, qte } : { nom, qte };
  });
  return { compo, inconnus };
}

async function articles(zone) {
  let lignes = [];
  const recettes = await q(table("recettes_cuisine").select("id, nom").order("nom"));
  const champs = (categories) => [
    { nom: "nom", libelle: "Nom", requis: true },
    { nom: "prix", libelle: "Prix ($)", type: "argent", requis: true },
    { nom: "categorie", libelle: "Catégorie (section de la caisse)", requis: true, aide: categories.length ? `Existantes : ${categories.join(", ")}` : "" },
    { nom: "emoji", libelle: "Emoji", max: 8 },
    { nom: "contenu", libelle: "Contenu du menu (affiché sur la caisse)", plein: true },
    { nom: "plats", libelle: "Plats préparés en cuisine — un par ligne, ex. « Boite de nuggets » ou « 2× Compote »", type: "zone", plein: true,
      aide: "Noms des recettes du jeu (onglet Cuisine › Recettes). Vide = le plat porte le nom de l'article." },
    { nom: "ordre", libelle: "Ordre d'affichage", type: "nombre" },
    { nom: "compact", libelle: "Affichage compact (plats seuls)", type: "case" },
    { nom: "actif", libelle: "En vente", type: "case" },
  ];
  const charger = async () => {
    lignes = await q(table("articles").select("*").order("ordre").order("nom"));
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🍔 ${lignes.filter((a) => a.actif).length} articles en vente</h2>
      <span class="discret">Les changements s'appliquent tout de suite à la caisse.</span><span class="espace"></span>
      <button class="btn principal" data-action="ajouter">+ Article</button></div>
      ${tableau(lignes, [
        { titre: "", rendu: (a) => `<span style="font-size:22px">${echapper(a.emoji || "")}</span>` },
        { titre: "Article", rendu: (a) => `<strong style="${a.actif ? "" : "opacity:.5"}">${echapper(a.nom)}</strong>${a.contenu ? `<div class="discret">${echapper(a.contenu)}</div>` : ""}`
          + (a.composition?.length ? `<div class="discret">🍳 ${echapper(compositionEnTexte(a.composition, recettes).split("\n").join(" · "))}</div>` : "") },
        { titre: "Catégorie", rendu: (a) => echapper(a.categorie) },
        { titre: "Prix", classe: "droite", rendu: (a) => `<strong>${fmt(a.prix)}</strong>` },
        { titre: "", rendu: (a) => a.actif ? "" : '<span class="badge">retiré</span>' },
      ], { actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button>` })}</div>`;
  };
  const categories = () => [...new Set(lignes.map((a) => a.categorie))];
  // texte des plats -> composition ; demande confirmation pour les plats qui ne sont pas des recettes du jeu
  const lireComposition = async (o) => {
    const { compo, inconnus } = texteEnComposition(o.plats, recettes);
    delete o.plats;
    if (inconnus.length && !(await confirmer(`Pas de recette du jeu pour : ${inconnus.join(", ")}. Les garder quand même (affichés en cuisine, sans ingrédients) ?`, "Garder"))) return null;
    return compo;
  };
  brancherActions(zone, () => lignes, {
    ajouter: () => formulaireEnFenetre("Nouvel article", champs(categories()), { actif: true, ordre: (lignes.at(-1)?.ordre || 0) + 10 }, async (o) => {
      const composition = await lireComposition(o);
      if (!composition) return false;
      const id = o.nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Date.now().toString(36).slice(-4);
      await q(table("articles").insert({ ...o, composition, id, ordre: o.ordre ?? 0 })); toast("Article ajouté à la carte."); charger();
    }),
    modifier: (a) => formulaireEnFenetre(`Modifier ${a.nom}`, champs(categories()), { ...a, plats: compositionEnTexte(a.composition, recettes) }, async (o) => {
      const composition = await lireComposition(o);
      if (!composition) return false;
      await q(table("articles").update({ ...o, composition, ordre: o.ordre ?? a.ordre }).eq("id", a.id)); toast("Carte mise à jour."); charger();
    }),
  });
  await charger();
}

async function tarifs(zone) {
  let lignes = [];
  const champs = [
    { nom: "nom", libelle: "Nom", requis: true },
    { nom: "court", libelle: "Texte du bouton", requis: true },
    { nom: "pourcentage", libelle: "Pourcentage (−10 = remise, 10 = majoration)", type: "nombre", requis: true },
    { nom: "emoji", libelle: "Emoji", max: 8 },
  ];
  const charger = async () => {
    lignes = await q(table("tarifs").select("*").order("ordre"));
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🧾 Tarifs</h2><span class="discret">Les 3 premiers apparaissent sur la caisse.</span></div>
      ${tableau(lignes, [
        { titre: "Tarif", rendu: (t) => `${echapper(t.emoji || "")} <strong>${echapper(t.nom)}</strong>` },
        { titre: "Bouton", rendu: (t) => echapper(t.court || "") },
        { titre: "Effet", classe: "droite", rendu: (t) => Number(t.pourcentage) ? `${t.pourcentage > 0 ? "+" : ""}${t.pourcentage} %` : "—" },
      ], { actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    modifier: (t) => formulaireEnFenetre(`Modifier ${t.nom}`, champs, t, async (o) => {
      if (!Number.isFinite(o.pourcentage) || Math.abs(o.pourcentage) > 100) throw new Error("Pourcentage entre −100 et 100.");
      await q(table("tarifs").update(o).eq("id", t.id)); toast("Tarif mis à jour."); charger();
    }),
  });
  await charger();
}

async function ingredients(zone) {
  let lignes = [];
  const champs = [
    { nom: "prix_superette", libelle: "Prix à la supérette ($ l'unité)", type: "argent" },
    { nom: "prix_fournisseur", libelle: "Prix chez Raven / Sunny ($ l'unité)", type: "argent" },
    { nom: "fournisseur", libelle: "Fournisseur le moins cher", type: "choix", options: [["", "—"], ["Raven", "Raven"], ["Sunny", "Sunny"], ["Supérette", "Supérette"]] },
    { nom: "note", libelle: "Note", plein: true },
  ];
  const charger = async () => {
    lignes = await q(table("ingredients").select("*").order("nom"));
    const sansPrix = lignes.filter((i) => i.prix_superette == null && i.prix_fournisseur == null).length;
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🧺 ${lignes.length} ingrédients</h2>
      <span class="discret">${sansPrix ? `${sansPrix} sans prix. ` : ""}Les prix servent au coût des listes de courses (onglet Cuisine).</span></div>
      ${tableau(lignes, [
        { titre: "Ingrédient", rendu: (i) => `<strong>${echapper(i.nom)}</strong>${i.note ? `<div class="discret">${echapper(i.note)}</div>` : ""}` },
        { titre: "Supérette", classe: "droite", rendu: (i) => i.prix_superette != null ? fmt(i.prix_superette) : "—" },
        { titre: "Raven / Sunny", classe: "droite", rendu: (i) => i.prix_fournisseur != null ? fmt(i.prix_fournisseur) : "—" },
        { titre: "Économie", classe: "droite", rendu: (i) => i.prix_superette != null && i.prix_fournisseur != null ? `<span class="${i.prix_fournisseur < i.prix_superette ? "vert" : ""}">${fmt(i.prix_superette - i.prix_fournisseur)}</span>` : "" },
        { titre: "Chez", rendu: (i) => echapper(i.fournisseur || "") },
      ], { actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button>` })}</div>`;
  };
  brancherActions(zone, () => lignes, {
    modifier: (i) => formulaireEnFenetre(i.nom, champs, i, async (o) => {
      o.fournisseur = o.fournisseur || null;
      await q(table("ingredients").update(o).eq("nom", i.nom)); toast("Prix enregistré."); charger();
    }),
  });
  await charger();
}

async function reglages(zone) {
  const r = await q(table("reglages").select("*").eq("id", 1).single());
  const champs = [
    { nom: "entreprise", libelle: "Nom de l'entreprise", requis: true },
    { nom: "sous_titre", libelle: "Sous-titre" },
    { nom: "telephones", libelle: "Téléphones (séparés par des virgules)", plein: true },
    { nom: "mode_impot", libelle: "Calcul de l'impôt", type: "choix", plein: true, options: [
      ["forfait", "Taux unique : le taux de la tranche atteinte s'applique à tout le bénéfice"],
      ["tranches", "Barème progressif : chaque tranche à son taux"]] },
    { nom: "jour_limite", libelle: "Déclaration avant le … du mois suivant", type: "nombre", min: 1 },
    { nom: "plafond_dons", libelle: "Plafond des dons ($)", type: "nombre", min: 0 },
    { nom: "periode_dons", libelle: "Plafond des dons calculé", type: "choix", options: [["mois", "par mois"], ["annee", "par an"], ["don", "par don"]] },
  ];
  const f = formulaire(champs, { ...r, telephones: (r.telephones || []).join(", ") });
  zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">⚙️ Réglages</h2></div><div id="form"></div>
    <p class="discret">Barème (Art. III) : ${r.tranches.map(([p, t], i) => p === null ? `au-delà : ${t * 100} %` : `${i ? "jusqu'à" : "jusqu'à"} ${fmt(p * 100)} : ${t * 100} %`).join(" · ")}</p>
    <div style="display:flex;justify-content:flex-end"><button class="btn principal" id="enregistrer">Enregistrer</button></div></div>
    <div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🔐 Code gérant</h2><span class="espace"></span>
      <button class="btn" id="changer-code">Changer le code</button></div>
      <p class="discret">Le nouveau code remplace l'ancien tout de suite : les autres appareils devront le retaper.
      Code oublié : dans Supabase › SQL Editor, exécute <code>delete from acces;</code> puis rouvre l'espace gérant pour en choisir un nouveau.</p></div>`;
  $("#form", zone).appendChild(f);
  $("#enregistrer", zone).onclick = async () => {
    try {
      const o = lireFormulaire(f, champs);
      o.telephones = (o.telephones || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (!(o.jour_limite >= 1 && o.jour_limite <= 28)) throw new Error("Le jour limite doit être entre 1 et 28.");
      await q(table("reglages").update(o).eq("id", 1)); toast("Réglages enregistrés.");
    } catch (e) { toast(e.message, true); }
  };
  const champsCode = [
    { nom: "code", libelle: "Nouveau code (4 caractères minimum)", type: "motdepasse", requis: true, plein: true },
    { nom: "confirmation", libelle: "Confirme le nouveau code", type: "motdepasse", requis: true, plein: true },
  ];
  $("#changer-code", zone).onclick = () => formulaireEnFenetre("Changer le code gérant", champsCode, {}, async (o) => {
    if (o.code !== o.confirmation) throw new Error("Les deux codes ne sont pas identiques.");
    await definirCode(o.code);
    toast("Nouveau code enregistré : les autres appareils devront le retaper.");
  });
}

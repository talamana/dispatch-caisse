// Carte du restaurant (articles, tarifs) et réglages de l'entreprise (Art. III).
import { definirCode, q, table } from "../api.js";
import { LIEUX, lieuDAchat, lireComposition } from "../cuisine_calc.js";
import { $, $$, brancherActions, confirmer, echapper, fenetre, fmt, formulaire, formulaireEnFenetre, lireFormulaire, tableau, toast } from "../outils.js";

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

// composition d'un ingrédient combiné <-> texte « 2× Farine » (une ligne par composant)
const compoIngrEnTexte = (compo) => (compo || []).map((c) => `${(c.qte || 1) > 1 ? `${c.qte}× ` : ""}${c.nom}`).join("\n");

async function ingredients(zone) {
  let lignes = [];
  const champs = [
    { nom: "prix_superette", libelle: "Prix à la supérette ($ l'unité)", type: "argent" },
    { nom: "prix_maraicher", libelle: "Prix au maraîcher ($ l'unité)", type: "argent" },
    { nom: "prix_fournisseur", libelle: "Prix chez Raven / Sunny ($ l'unité)", type: "argent" },
    { nom: "fournisseur", libelle: "Où l'acheter", type: "choix", options: [["", "Le moins cher (automatique)"], ...LIEUX.map((l) => [l, l])] },
    { nom: "compose", libelle: "Ingrédient combiné : composé de (un par ligne, ex. « 2× Farine »)", type: "zone", plein: true,
      aide: "Vide = ingrédient acheté tel quel. Rempli = on le fabrique : la liste de courses contient ses composants." },
    { nom: "produit", libelle: "Unités obtenues par fabrication", type: "nombre", min: 1 },
    { nom: "note", libelle: "Remarque", type: "zone", plein: true },
  ];
  const cle = (t) => sansAccent(t);
  const lieuAffiche = (i) => {
    const l = lieuDAchat(i);
    return l ? `${echapper(l)}${i.fournisseur ? "" : ' <span class="discret">(moins cher)</span>'}` : '<span class="discret">à définir</span>';
  };
  const prix = (v) => (v != null ? fmt(v) : "—");
  // Enregistre une composition ; crée les composants qui ne sont pas encore dans la liste
  const enregistrerCompo = async (nom, compo, extra = {}) => {
    const connus = new Set(lignes.map((l) => cle(l.nom)));
    const nouveaux = [...new Set(compo.map((c) => c.nom).filter((n) => !connus.has(cle(n)) && cle(n) !== cle(nom)))];
    for (const n of nouveaux) await q(table("ingredients").insert({ nom: n }));
    // noms écrits comme dans la liste (accents / majuscules)
    const parCle = new Map(lignes.map((l) => [cle(l.nom), l.nom]));
    const propre = compo.filter((c) => cle(c.nom) !== cle(nom)).map((c) => ({ nom: parCle.get(cle(c.nom)) || c.nom, qte: c.qte }));
    await q(table("ingredients").update({ ...extra, composition: propre }).eq("nom", nom));
    return nouveaux;
  };
  const charger = async () => {
    lignes = await q(table("ingredients").select("*").order("nom"));
    const sansPrix = lignes.filter((i) => i.prix_superette == null && i.prix_maraicher == null && i.prix_fournisseur == null && !(i.composition || []).length).length;
    const aConvertir = lignes.filter((i) => i.note && !(i.composition || []).length && lireComposition(i.note).length).length;
    zone.innerHTML = `<div class="bloc"><div class="bloc-tete"><h2 class="titre-bloc">🧺 ${lignes.length} ingrédients</h2>
      <span class="discret">${sansPrix ? `${sansPrix} sans prix. ` : ""}Prix et lieux servent à la liste de courses (onglet Cuisine).</span><span class="espace"></span>
      ${aConvertir ? `<button class="btn" id="depuis-remarques">🔁 Combinés depuis les remarques (${aConvertir})</button>` : ""}</div>
      ${tableau(lignes, [
        { titre: "Ingrédient", rendu: (i) => `<strong>${echapper(i.nom)}</strong>${(i.composition || []).length ? ` <span class="badge">combiné</span><div class="discret">= ${echapper(compoIngrEnTexte(i.composition).split("\n").join(" + "))}${i.produit > 1 ? ` → ${i.produit} unités` : ""}</div>` : ""}${i.note ? `<div class="discret">📝 ${echapper(i.note)}</div>` : ""}` },
        { titre: "Supérette", classe: "droite", rendu: (i) => prix(i.prix_superette) },
        { titre: "Maraîcher", classe: "droite", rendu: (i) => prix(i.prix_maraicher) },
        { titre: "Raven / Sunny", classe: "droite", rendu: (i) => prix(i.prix_fournisseur) },
        { titre: "Où acheter", rendu: (i) => ((i.composition || []).length ? '<span class="discret">fabriqué</span>' : lieuAffiche(i)) },
      ], { actions: () => `<button class="btn petit icone" data-action="modifier" title="Modifier">✏️</button>` })}</div>`;
    const b = $("#depuis-remarques", zone);
    if (b) b.onclick = convertirRemarques;
  };
  const convertirRemarques = async () => {
    const candidats = lignes.filter((i) => i.note && !(i.composition || []).length)
      .map((i) => ({ i, compo: lireComposition(i.note) })).filter((x) => x.compo.length);
    const connus = new Set(lignes.map((l) => cle(l.nom)));
    const contenu = `<p class="discret">Coche les ingrédients qui sont vraiment combinés. Les composants en <em>italique</em> ne sont pas encore dans la liste : ils seront ajoutés.</p>
      <table class="liste compacte"><tbody>${candidats.map((x, n) => `<tr><td><label class="case"><input type="checkbox" data-n="${n}" ${x.compo.some((c) => connus.has(cle(c.nom))) ? "checked" : ""}> <strong>${echapper(x.i.nom)}</strong></label>
        <div class="discret">📝 ${echapper(x.i.note)}</div></td>
        <td>= ${x.compo.map((c) => `${c.qte > 1 ? `${c.qte}× ` : ""}${connus.has(cle(c.nom)) ? echapper(c.nom) : `<em>${echapper(c.nom)}</em>`}`).join(" + ")}</td></tr>`).join("")}</tbody></table>`;
    await fenetre({ titre: "Ingrédients combinés", large: true, contenu, boutons: [{ texte: "Annuler" }, { texte: "Enregistrer la sélection", classe: "principal", action: async (f) => {
      const choisis = [...f.querySelectorAll("[data-n]:checked")].map((c) => candidats[Number(c.dataset.n)]);
      let ajoutes = 0;
      for (const x of choisis) ajoutes += (await enregistrerCompo(x.i.nom, x.compo)).length;
      toast(`${choisis.length} ingrédient(s) combiné(s) enregistré(s)${ajoutes ? `, ${ajoutes} composant(s) ajouté(s) à la liste` : ""}.`);
      charger();
    } }] });
  };
  brancherActions(zone, () => lignes, {
    modifier: (i) => formulaireEnFenetre(i.nom, champs, { ...i, compose: compoIngrEnTexte(i.composition) }, async (o) => {
      const compo = lireComposition(o.compose);
      delete o.compose;
      o.fournisseur = o.fournisseur || null;
      o.produit = Math.max(1, Math.round(o.produit || 1));
      const ajoutes = await enregistrerCompo(i.nom, compo, o);
      toast(`Ingrédient enregistré${ajoutes.length ? ` (ajouté à la liste : ${ajoutes.join(", ")})` : ""}.`); charger();
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

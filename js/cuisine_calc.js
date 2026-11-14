// Calculs de la cuisine (sans accès au réseau : testables à part).
// - eclater : une commande de caisse -> les plats à préparer (les menus sont séparés en plats)
// - besoins : des plats -> les cuissons à lancer et les ingrédients à réunir (sous-recettes comprises)

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function indexer({ articles = [], recettes = [], ingredients = [] }) {
  const parId = new Map(recettes.map((r) => [r.id, r]));
  const parNom = new Map(recettes.map((r) => [norm(r.nom), r]));
  // niveau : 0 pour un plat servi, 1 pour une recette utilisée dans une autre (Crêpe), etc.
  const parents = new Map();
  for (const r of recettes) for (const i of r.ingredients || []) {
    const sous = parNom.get(norm(i.nom));
    if (sous) parents.set(sous.id, [...(parents.get(sous.id) || []), r.id]);
  }
  const niveau = new Map();
  const calcNiveau = (id, pile = new Set()) => {
    if (niveau.has(id)) return niveau.get(id);
    if (pile.has(id)) return 0;                       // boucle : on s'arrête
    pile.add(id);
    const n = Math.max(0, ...(parents.get(id) || []).map((p) => calcNiveau(p, pile) + 1));
    pile.delete(id); niveau.set(id, n);
    return n;
  };
  recettes.forEach((r) => calcNiveau(r.id));
  return {
    articles: new Map(articles.map((a) => [a.id, a])),
    recettes: parId, recettesParNom: parNom, niveau,
    prix: new Map(ingredients.map((i) => [norm(i.nom), i])),
  };
}

// Plats d'une commande : [{ cle, recette, nom, qte, menus: ["Le Cadet"] }] (regroupés)
export function eclater(commande, idx) {
  const plats = new Map();
  const ajouter = (cle, recette, nom, qte, menu) => {
    const p = plats.get(cle) || { cle, recette, nom, qte: 0, menus: [] };
    p.qte += qte;
    if (menu && !p.menus.includes(menu)) p.menus.push(menu);
    plats.set(cle, p);
  };
  for (const l of commande.lignes || []) {
    const qte = Number(l.qte) || 0;
    const article = idx.articles.get(l.id);
    const compo = article?.composition || [];
    if (!compo.length) {                                // pas de composition : le plat porte le nom de l'article
      const r = idx.recettesParNom.get(norm(l.nom || article?.nom));
      if (r) ajouter(r.id, r.id, r.nom, qte, null);
      else ajouter("x:" + norm(l.nom || l.id), null, l.nom || l.id, qte, null);
      continue;
    }
    const menu = compo.length > 1 ? (article?.nom || l.nom) : null;
    for (const c of compo) {
      const n = qte * (Number(c.qte) || 1);
      const r = c.recette ? idx.recettes.get(c.recette) : idx.recettesParNom.get(norm(c.nom));
      if (r) ajouter(r.id, r.id, r.nom, n, menu);
      else ajouter("x:" + norm(c.nom || c.recette), null, c.nom || c.recette, n, menu);
    }
  }
  return [...plats.values()];
}

// portions : Map(recetteId -> portions à servir). Renvoie les cuissons et les ingrédients.
// Les recettes sont traitées par niveau : un plat avant ses sous-recettes (Crêpe au chocolat avant Crêpe),
// pour que la demande d'une sous-recette soit complète quand on calcule ses cuissons.
export function besoins(portions, idx) {
  const demande = new Map([...portions].filter(([, n]) => n > 0));
  const traites = new Set();
  const cuissons = [];
  for (;;) {
    const id = [...demande.keys()].filter((x) => !traites.has(x))
      .sort((a, b) => (idx.niveau.get(a) || 0) - (idx.niveau.get(b) || 0))[0];
    if (id === undefined) break;
    traites.add(id);
    const r = idx.recettes.get(id);
    if (!r) continue;
    const n = demande.get(id);
    const produit = Math.max(1, Number(r.produit) || 1);
    const fois = Math.ceil(n / produit);
    cuissons.push({ recette: id, nom: r.nom, portions: n, produit, cuissons: fois, en_trop: fois * produit - n });
    for (const i of r.ingredients || []) {
      const sous = idx.recettesParNom.get(norm(i.nom));
      if (sous && sous.id !== id && !traites.has(sous.id)) {
        demande.set(sous.id, (demande.get(sous.id) || 0) + (Number(i.qte) || 1) * fois);
      }
    }
  }
  return recompter(cuissons, idx);
}

function recompter(cuissons, idx) {
  const ingredients = new Map();
  for (const c of cuissons) {
    const r = idx.recettes.get(c.recette);
    for (const i of r.ingredients || []) {
      const sous = idx.recettesParNom.get(norm(i.nom));
      if (sous && sous.id !== c.recette) continue;                 // fourni par une autre cuisson
      const cle = norm(i.nom);
      const e = ingredients.get(cle) || { nom: i.nom, qte: 0 };
      e.qte += (Number(i.qte) || 1) * c.cuissons;
      ingredients.set(cle, e);
    }
  }
  const liste = [...ingredients.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  let superette = 0, fournisseur = 0, sansPrixS = 0, sansPrixF = 0;
  for (const e of liste) {
    const p = idx.prix.get(norm(e.nom)) || {};
    e.prix_superette = p.prix_superette ?? null;
    e.prix_fournisseur = p.prix_fournisseur ?? null;
    e.fournisseur = p.fournisseur || null;
    if (e.prix_superette == null) sansPrixS++; else superette += e.prix_superette * e.qte;
    if (e.prix_fournisseur == null) sansPrixF++; else fournisseur += e.prix_fournisseur * e.qte;
  }
  cuissons.sort((a, b) => (idx.niveau.get(b.recette) || 0) - (idx.niveau.get(a.recette) || 0) || a.nom.localeCompare(b.nom, "fr"));
  return { cuissons, ingredients: liste, cout: { superette, fournisseur, sansPrixS, sansPrixF } };
}

// Total des plats de plusieurs commandes (en option sans les plats déjà cochés)
export function portionsDe(commandes, idx, sansFaits = true) {
  const p = new Map();
  for (const c of commandes) for (const plat of eclater(c, idx)) {
    if (!plat.recette) continue;
    if (sansFaits && (c.faits || []).includes(plat.cle)) continue;
    p.set(plat.recette, (p.get(plat.recette) || 0) + plat.qte);
  }
  return p;
}

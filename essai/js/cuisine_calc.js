// Calculs de la cuisine (sans accès au réseau : testables à part).
// - eclater : une commande de caisse -> les plats à préparer (les menus sont séparés en plats)
// - besoins : des plats -> les cuissons à lancer et les ingrédients à réunir (sous-recettes comprises)

const ALIAS = { "lait": "pot de lait entier", "pot de lait": "pot de lait entier", "lait entier": "pot de lait entier" };
const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const norm = (t) => { const n = sansAccents(t); return ALIAS[n] || n; };
export const normIngredient = norm;
// nom affiché d'un ingrédient (synonymes : « Lait » = « Pot de lait entier »)
export const nomCanonique = (t) => (ALIAS[sansAccents(t)] ? "Pot de lait entier" : String(t || "").trim());

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
  // ingrédients combinés : niveau 0 = utilisé directement, 1 = sert à fabriquer un autre ingrédient…
  const prix = new Map(ingredients.map((i) => [norm(i.nom), i]));
  const parentsI = new Map();
  for (const i of ingredients) for (const c of i.composition || []) {
    parentsI.set(norm(c.nom), [...(parentsI.get(norm(c.nom)) || []), norm(i.nom)]);
  }
  const niveauI = new Map();
  const calcNiveauI = (cle, pile = new Set()) => {
    if (niveauI.has(cle)) return niveauI.get(cle);
    if (pile.has(cle)) return 0;
    pile.add(cle);
    const n = Math.max(0, ...(parentsI.get(cle) || []).map((p) => calcNiveauI(p, pile) + 1));
    pile.delete(cle); niveauI.set(cle, n);
    return n;
  };
  return {
    niveauI: { get: (cle) => calcNiveauI(cle) },
    articles: new Map(articles.map((a) => [a.id, a])),
    recettes: parId, recettesParNom: parNom, niveau,
    prix,
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

// --- Où acheter ---------------------------------------------------------------------------------
export const LIEUX = ["Maraîcher", "Raven", "Sunny", "Supérette"];
const ORDRE_LIEUX = ["Maraîcher", "Raven", "Sunny", "Raven / Sunny", "Supérette", null];

export function prixChez(p, lieu) {
  if (!p) return null;
  if (lieu === "Supérette") return p.prix_superette ?? null;
  if (lieu === "Maraîcher") return p.prix_maraicher ?? null;
  if (lieu === "Raven" || lieu === "Sunny" || lieu === "Raven / Sunny") return p.prix_fournisseur ?? null;
  return null;
}

// Lieu choisi par le gérant, sinon le moins cher parmi les prix connus, sinon null (à définir)
export function lieuDAchat(p) {
  if (!p) return null;
  if (LIEUX.includes(p.fournisseur)) return p.fournisseur;
  const offres = [["Maraîcher", p.prix_maraicher], ["Raven / Sunny", p.prix_fournisseur], ["Supérette", p.prix_superette]]
    .filter(([, v]) => v != null);
  if (!offres.length) return null;
  return offres.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

function recompter(cuissons, idx) {
  // 1. ingrédients des cuissons (les sous-recettes sont des cuissons à part)
  const demande = new Map();
  const ajouter = (nom, qte) => {
    const cle = norm(nom);
    const e = demande.get(cle) || { nom, qte: 0 };
    e.qte += qte; demande.set(cle, e);
  };
  for (const c of cuissons) {
    const r = idx.recettes.get(c.recette);
    for (const i of r.ingredients || []) {
      const sous = idx.recettesParNom.get(norm(i.nom));
      if (sous && sous.id !== c.recette) continue;                 // fourni par une autre cuisson
      ajouter(i.nom, (Number(i.qte) || 1) * c.cuissons);
    }
  }
  // 2. ingrédients combinés : on les fabrique, donc on achète leurs composants
  const preparations = [];
  const traites = new Set();
  for (;;) {
    const cle = [...demande.keys()].filter((k) => !traites.has(k) && (idx.prix.get(k)?.composition || []).length)
      .sort((a, b) => idx.niveauI.get(a) - idx.niveauI.get(b))[0];
    if (cle === undefined) break;
    traites.add(cle);
    const p = idx.prix.get(cle), e = demande.get(cle);
    const produit = Math.max(1, Number(p.produit) || 1);
    const fois = Math.ceil(e.qte / produit);
    preparations.push({ nom: e.nom, qte: e.qte, produit, fois, en_trop: fois * produit - e.qte,
      composants: p.composition.map((c) => ({ nom: c.nom, qte: (Number(c.qte) || 1) * fois })) });
    demande.delete(cle);
    for (const c of p.composition) if (!traites.has(norm(c.nom))) ajouter(c.nom, (Number(c.qte) || 1) * fois);
  }
  // 3. achats regroupés par lieu, avec le prix du lieu
  const liste = [...demande.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const groupes = new Map();
  let total = 0, sansPrix = 0, toutSuperette = 0, sansPrixSuperette = 0;
  for (const e of liste) {
    const p = idx.prix.get(norm(e.nom));
    e.lieu = lieuDAchat(p);
    e.prix = prixChez(p, e.lieu);
    e.cout = e.prix == null ? null : Math.round(e.prix * e.qte / 100) * 100;   // pas de centimes
    if (e.cout == null) sansPrix++; else total += e.cout;
    if (p?.prix_superette == null) sansPrixSuperette++; else toutSuperette += Math.round(p.prix_superette * e.qte / 100) * 100;
    const g = groupes.get(e.lieu) || { lieu: e.lieu, articles: [], total: 0, sansPrix: 0 };
    g.articles.push(e);
    if (e.cout == null) g.sansPrix++; else g.total += e.cout;
    groupes.set(e.lieu, g);
  }
  const achats = [...groupes.values()].sort((a, b) => ORDRE_LIEUX.indexOf(a.lieu) - ORDRE_LIEUX.indexOf(b.lieu));
  cuissons.sort((a, b) => (idx.niveau.get(b.recette) || 0) - (idx.niveau.get(a.recette) || 0) || a.nom.localeCompare(b.nom, "fr"));
  preparations.reverse();                                        // à fabriquer d'abord : les plus « profonds »
  return { cuissons, preparations, achats, ingredients: liste,
    cout: { total, sansPrix, toutSuperette, sansPrixSuperette } };
}

// --- Remarques -> composition (« Farine + 2 Sucre », « 2x Lait, Oeuf », « Composé de : … ») ------------
export function lireComposition(texte) {
  if (!texte) return [];
  let t = String(texte);
  if (t.includes(":")) t = t.slice(t.lastIndexOf(":") + 1);
  return t.split(/\n|,|;|\+|\/|\bet\b|&/i).map((x) => x.trim().replace(/^[-•*]\s*/, "").replace(/[.!]+$/, "")).filter(Boolean).map((x) => {
    let m = x.match(/^(\d+)\s*[x×*]?\s+(.+)$/i) || x.match(/^(\d+)\s*[x×*]\s*(.+)$/i);
    if (m) return { nom: nomCanonique(m[2]), qte: Number(m[1]) };
    m = x.match(/^(.+?)\s*(?:[x×*]\s*(\d+)|\((\d+)\))$/i);
    if (m) return { nom: nomCanonique(m[1]), qte: Number(m[2] || m[3]) };
    return { nom: nomCanonique(x), qte: 1 };
  }).filter((c) => c.nom.length > 1);
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

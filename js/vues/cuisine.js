// Cuisine : ouverte aux employés (comme la caisse).
// - Commandes : chaque commande de la caisse arrive ici, menus séparés en plats, à cocher au fur et à mesure.
// - Ingrédients : ce qu'il faut pour les commandes cochées (cuissons, sous-recettes, coût si les prix sont connus).
// - Recettes : toutes les recettes du jeu, avec un calcul pour préparer à l'avance.
import { rpc } from "../api.js";
import { besoins, eclater, indexer, portionsDe } from "../cuisine_calc.js";
import { $, $$, echapper, fenetre, fmt, messageErreur, toast } from "../outils.js";

const ETATS = { a_faire: ["À faire", ""], en_cours: ["En cours", "orange"], prete: ["Prête", "vert"] };
const RAFRAICHIR_MS = 8000;
const memoire = {
  lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* rien */ } },
};

export async function afficher(vue, params) {
  const onglet = params[0] === "recettes" ? "recettes" : "commandes";
  vue.innerHTML = `<div class="page large"><div class="titre-page"><h1>Cuisine</h1>
      <span class="discret" id="cuisine-maj"></span></div>
    <div class="onglets-page"><button data-onglet="commandes" aria-selected="${onglet === "commandes"}">🍳 Commandes</button>
      <button data-onglet="recettes" aria-selected="${onglet === "recettes"}">📖 Recettes</button></div>
    <div id="zone-cuisine"><div class="vide">Chargement…</div></div></div>`;
  $$("[data-onglet]", vue).forEach((b) => (b.onclick = () => { location.hash = `#/cuisine/${b.dataset.onglet}`; }));
  const donnees = await rpc("cuisine");
  if (!vue.isConnected) return;
  const idx = indexer(donnees);
  const zone = $("#zone-cuisine", vue);
  return onglet === "recettes" ? recettes(zone, donnees, idx) : commandes(zone, vue, donnees, idx);
}

// --- Tableaux « cuissons », « à préparer » et « à acheter » (communs aux deux onglets) -------------
const ICONES = { "Maraîcher": "🥕", "Raven": "📞", "Sunny": "📞", "Raven / Sunny": "📞", "Supérette": "🛒" };
const nomLieu = (l) => (l ? `${ICONES[l] || "📍"} ${l}` : "❓ Lieu à définir");

function htmlBesoins(b, titreVide) {
  if (!b.cuissons.length) return `<div class="vide">${echapper(titreVide)}</div>`;
  const prixConnus = b.ingredients.some((i) => i.prix != null);
  const sousTotal = (g) => g.total || !g.sansPrix ? fmt(g.total) + (g.sansPrix ? ` <span class="discret">+ ${g.sansPrix} sans prix</span>` : "") : "";
  const economie = b.cout.toutSuperette - b.cout.total;
  return `<h3 class="sous-titre">Cuissons à lancer</h3>
    <table class="liste compacte"><thead><tr><th>Recette</th><th class="droite">Portions</th><th class="droite">Cuissons</th></tr></thead><tbody>
    ${b.cuissons.map((c) => `<tr><td>${echapper(c.nom)}${c.produit > 1 ? `<div class="discret">${c.produit} portions par cuisson${c.en_trop ? ` · ${c.en_trop} en trop` : ""}</div>` : ""}</td>
      <td class="droite">${c.portions}</td><td class="droite"><strong>${c.cuissons}</strong></td></tr>`).join("")}</tbody></table>
    ${b.preparations.length ? `<h3 class="sous-titre">À préparer avant (ingrédients combinés)</h3>
    <ul class="preparations">${b.preparations.map((p) => `<li><strong>${p.fois}× ${echapper(p.nom)}</strong>
      ${p.produit > 1 ? `<span class="discret">(${p.produit} par fabrication, ${p.qte} nécessaires${p.en_trop ? `, ${p.en_trop} en trop` : ""})</span>` : ""}
      <div class="discret">avec ${p.composants.map((c) => `${c.qte} ${echapper(c.nom)}`).join(", ")}</div></li>`).join("")}</ul>` : ""}
    <h3 class="sous-titre">À acheter</h3>
    ${b.achats.map((g) => `<div class="lieu-achat"><div class="lieu-tete"><strong>${nomLieu(g.lieu)}</strong><span class="espace"></span>${sousTotal(g)}</div>
      <table class="liste compacte"><tbody>${g.articles.map((a) => `<tr><td>${echapper(a.nom)}</td><td class="droite"><strong>${a.qte}</strong></td>
        ${prixConnus ? `<td class="droite discret">${a.prix != null ? `${fmt(a.prix)} /u` : "—"}</td><td class="droite">${a.cout != null ? fmt(a.cout) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>`).join("")}
    ${prixConnus ? `<div class="total-courses"><span>Total</span><strong>${fmt(b.cout.total)}</strong>${b.cout.sansPrix ? `<span class="discret">+ ${b.cout.sansPrix} sans prix</span>` : ""}</div>
      ${economie > 0 && !b.cout.sansPrixSuperette ? `<p class="discret">Tout à la supérette : ${fmt(b.cout.toutSuperette)} — économie ${fmt(economie)}.</p>` : ""}`
    : '<p class="discret">Les prix et le lieu d\'achat (supérette, maraîcher, Raven, Sunny) se règlent dans l\'espace gérant › Carte & réglages › Ingrédients.</p>'}
    <div class="actions-ligne"><button class="btn" data-copier>📋 Copier la liste de courses</button></div>`;
}

function texteCourses(b, titre) {
  const lignes = [titre];
  for (const g of b.achats) {
    lignes.push("", `${g.lieu || "Lieu à définir"}${g.total ? ` (${fmt(g.total)})` : ""} :`);
    for (const a of g.articles) lignes.push(`- ${a.qte} × ${a.nom}`);
  }
  if (b.preparations.length) {
    lignes.push("", "À préparer avant :");
    for (const p of b.preparations) lignes.push(`- ${p.fois} × ${p.nom} (avec ${p.composants.map((c) => `${c.qte} ${c.nom}`).join(", ")})`);
  }
  lignes.push("", "Cuissons :");
  for (const c of b.cuissons) lignes.push(`- ${c.cuissons} × ${c.nom}${c.produit > 1 ? ` (${c.portions} portions)` : ""}`);
  if (b.cout.total) lignes.push("", `Total : ${fmt(b.cout.total)}${b.cout.sansPrix ? ` + ${b.cout.sansPrix} sans prix` : ""}`);
  return lignes.join("\n").replace(/\u202f|\u00a0/g, " ");
}

function brancherCopie(conteneur, texte) {
  const b = $("[data-copier]", conteneur);
  if (!b) return;
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(texte()); toast("Liste copiée : colle-la où tu veux (Discord, notes…)."); }
    catch { await fenetre({ titre: "Liste de courses", contenu: `<textarea class="champ" rows="14" readonly>${echapper(texte())}</textarea>`, boutons: [{ texte: "Fermer" }] }); }
  };
}

function detailRecette(r, idx) {
  const lignes = (r.ingredients || []).map((i) => {
    const sous = idx.recettesParNom.get(i.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim());
    return `<li><strong>${i.qte}×</strong> ${echapper(i.nom)}${sous ? ' <span class="badge">à cuisiner avant</span>' : ""}</li>`;
  }).join("");
  return fenetre({ titre: r.nom, contenu: `<p class="discret">Une cuisson donne ${r.produit} portion${r.produit > 1 ? "s" : ""}.</p><ul class="liste-ingredients">${lignes}</ul>`,
    boutons: [{ texte: "Fermer", classe: "principal" }] });
}

// --- Onglet Commandes ------------------------------------------------------------------------------
function commandes(zone, vue, donnees, idx) {
  let liste = donnees.commandes;
  const exclues = new Set(memoire.lire("cuisine_exclues", []));       // commandes décochées pour le calcul
  let sansFaits = memoire.lire("cuisine_sans_faits", true);
  let filtre = "toutes";
  const connues = new Set(liste.map((c) => c.id));

  zone.innerHTML = `<div class="cuisine">
    <section><div class="filtres" id="filtres"></div><div class="bons" id="bons"></div></section>
    <aside class="bloc besoins" id="besoins"></aside></div>`;

  const depuis = (d) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
    return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : `il y a ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  };
  const heure = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const dessinerBesoins = () => {
    const choisies = liste.filter((c) => !exclues.has(c.id));
    const b = besoins(portionsDe(choisies, idx, sansFaits), idx);
    const titre = `Pour ${choisies.length} commande${choisies.length > 1 ? "s" : ""}`;
    $("#besoins", zone).innerHTML = `<div class="bloc-tete"><h2 class="titre-bloc">🧺 Ingrédients</h2></div>
      <p class="discret">${titre} (coche ou décoche les commandes à gauche).</p>
      <label class="case"><input type="checkbox" id="sans-faits" ${sansFaits ? "checked" : ""}> Sans les plats déjà faits</label>
      ${htmlBesoins(b, "Aucun plat à préparer.")}`;
    $("#sans-faits", zone).onchange = (e) => { sansFaits = e.target.checked; memoire.ecrire("cuisine_sans_faits", sansFaits); dessinerBesoins(); };
    brancherCopie($("#besoins", zone), () => texteCourses(b, `Courses — ${titre.toLowerCase()} :`));
  };

  const dessiner = () => {
    const n = (e) => liste.filter((c) => e === "toutes" || c.etat === e).length;
    $("#filtres", zone).innerHTML = [["toutes", "Toutes"], ["a_faire", "À faire"], ["en_cours", "En cours"], ["prete", "Prêtes"]]
      .map(([k, v]) => `<button class="puce-filtre" data-filtre="${k}" aria-pressed="${filtre === k}">${v} <b>${n(k)}</b></button>`).join("");
    const visibles = liste.filter((c) => filtre === "toutes" || c.etat === filtre);
    $("#bons", zone).innerHTML = visibles.length ? visibles.map((c) => {
      const plats = eclater(c, idx);
      const faits = new Set(c.faits || []);
      const [libelle, couleur] = ETATS[c.etat] || [c.etat, ""];
      return `<article class="bon ${c.etat} ${c.nouvelle ? "nouvelle" : ""}" data-id="${c.id}">
        <header><label class="case"><input type="checkbox" data-selection ${exclues.has(c.id) ? "" : "checked"} title="Compter dans les ingrédients">
          <strong>N°${c.id}</strong></label><span class="discret">${heure(c.date)} · ${depuis(c.date)}</span>
          <span class="espace"></span><span class="badge ${couleur}">${libelle}</span></header>
        ${c.vendeur || c.client ? `<div class="discret qui">${echapper([c.vendeur && `Caisse : ${c.vendeur}`, c.client && `Client : ${c.client}`].filter(Boolean).join(" · "))}</div>` : ""}
        <ul class="plats">${plats.map((p) => `<li class="${faits.has(p.cle) ? "fait" : ""}">
          <label><input type="checkbox" data-plat="${echapper(p.cle)}" ${faits.has(p.cle) ? "checked" : ""}>
          <b>${p.qte}×</b> ${echapper(p.nom)}</label>
          ${p.recette ? `<button class="lien" data-recette="${echapper(p.recette)}" title="Voir la recette">ℹ️</button>` : '<span class="badge">sans recette</span>'}
          ${p.menus.length ? `<div class="discret menus">${echapper(p.menus.join(", "))}</div>` : ""}</li>`).join("")}</ul>
        <footer>${c.etat === "a_faire" ? '<button class="btn petit" data-etat="en_cours">En cours</button>' : ""}
          ${c.etat !== "prete" ? '<button class="btn petit vert" data-etat="prete">Prête ✓</button>' : ""}
          <button class="btn petit" data-etat="servie" title="Retirer de l'écran">Servie →</button></footer></article>`;
    }).join("") : `<div class="vide">${liste.length ? "Rien dans ce filtre." : "Aucune commande en attente. Elles arrivent ici dès qu'elles sont encaissées."}</div>`;
    $$(".puce-filtre", zone).forEach((b) => (b.onclick = () => { filtre = b.dataset.filtre; dessiner(); }));
    $("#cuisine-maj", vue).textContent = `Mis à jour à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    dessinerBesoins();
  };

  const changer = async (c, etat, faits) => {
    const avant = { etat: c.etat, faits: c.faits };
    if (etat) c.etat = etat;
    if (faits) c.faits = faits;
    if (etat === "servie") liste = liste.filter((x) => x.id !== c.id);
    dessiner();
    try { await rpc("cuisine_etat", { p_id: c.id, p_etat: etat || null, p_faits: faits || null }); }
    catch (err) { Object.assign(c, avant); if (etat === "servie") liste.push(c); liste.sort((a, b) => new Date(a.date) - new Date(b.date)); dessiner(); toast(messageErreur(err), true); }
  };

  zone.addEventListener("change", (e) => {
    const bon = e.target.closest(".bon"); if (!bon) return;
    const c = liste.find((x) => x.id === Number(bon.dataset.id)); if (!c) return;
    if (e.target.matches("[data-selection]")) {
      e.target.checked ? exclues.delete(c.id) : exclues.add(c.id);
      memoire.ecrire("cuisine_exclues", [...exclues]); dessinerBesoins();
    } else if (e.target.matches("[data-plat]")) {
      const faits = new Set(c.faits || []);
      e.target.checked ? faits.add(e.target.dataset.plat) : faits.delete(e.target.dataset.plat);
      const tous = eclater(c, idx).every((p) => faits.has(p.cle));
      changer(c, tous ? "prete" : c.etat === "a_faire" ? "en_cours" : null, [...faits]);
      if (tous) toast(`Commande n°${c.id} prête !`);
    }
  });
  zone.addEventListener("click", (e) => {
    const r = e.target.closest("[data-recette]");
    if (r) { const rec = idx.recettes.get(r.dataset.recette); if (rec) detailRecette(rec, idx); return; }
    const b = e.target.closest("[data-etat]"); if (!b) return;
    const c = liste.find((x) => x.id === Number(b.closest(".bon").dataset.id));
    if (c) changer(c, b.dataset.etat, null);
  });

  // Nouvelles commandes : on interroge la base toutes les 8 s
  let enCours = false;
  const rafraichir = async () => {
    if (enCours || document.hidden || !zone.isConnected) return;
    enCours = true;
    try {
      const nouvelles = await rpc("cuisine_commandes");
      for (const c of nouvelles) if (!connues.has(c.id)) { c.nouvelle = true; connues.add(c.id); toast(`🔔 Nouvelle commande n°${c.id}`); }
      const anciennes = new Map(liste.map((c) => [c.id, c]));
      liste = nouvelles.map((c) => ({ ...c, nouvelle: c.nouvelle || anciennes.get(c.id)?.nouvelle }));
      if (!zone.contains(document.activeElement) || document.activeElement === document.body) dessiner();
    } catch { /* réseau : on réessaie au prochain tour */ }
    finally { enCours = false; }
  };
  const minuteur = setInterval(rafraichir, RAFRAICHIR_MS);
  const visible = () => { if (!document.hidden) rafraichir(); };
  document.addEventListener("visibilitychange", visible);
  dessiner();
  return () => { clearInterval(minuteur); document.removeEventListener("visibilitychange", visible); };
}

// --- Onglet Recettes -------------------------------------------------------------------------------
function recettes(zone, donnees, idx) {
  const choix = new Map(memoire.lire("cuisine_preparation", []));
  let recherche = "";
  zone.innerHTML = `<div class="cuisine">
    <section><input class="champ" id="recherche" placeholder="Chercher une recette ou un ingrédient (ex. crêpe, fraise)…" autocomplete="off">
      <div class="grille-recettes" id="grille"></div></section>
    <aside class="bloc besoins" id="besoins"></aside></div>`;
  const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const dessinerBesoins = () => {
    const b = besoins(new Map([...choix].filter(([, n]) => n > 0)), idx);
    const total = [...choix.values()].reduce((s, n) => s + n, 0);
    $("#besoins", zone).innerHTML = `<div class="bloc-tete"><h2 class="titre-bloc">🧺 Préparation</h2><span class="espace"></span>
      ${total ? '<button class="btn petit" id="vider">Vider</button>' : ""}</div>
      <p class="discret">${total ? `${total} portion${total > 1 ? "s" : ""} choisie${total > 1 ? "s" : ""}.` : "Ajoute des plats avec + pour calculer les ingrédients (préparer du stock, une grosse commande…)."}</p>
      ${htmlBesoins(b, "Rien de choisi.")}`;
    const v = $("#vider", zone); if (v) v.onclick = () => { choix.clear(); sauver(); dessinerGrille(); dessinerBesoins(); };
    brancherCopie($("#besoins", zone), () => texteCourses(b, "Courses — préparation :"));
  };
  const sauver = () => memoire.ecrire("cuisine_preparation", [...choix]);
  const dessinerGrille = () => {
    const q = norm(recherche.trim());
    const liste = donnees.recettes.filter((r) => !q || norm(r.nom).includes(q) || r.ingredients.some((i) => norm(i.nom).includes(q)));
    $("#grille", zone).innerHTML = liste.length ? liste.map((r) => {
      const n = choix.get(r.id) || 0;
      return `<article class="recette ${n ? "choisie" : ""}" data-id="${echapper(r.id)}">
        <header><strong>${echapper(r.nom)}</strong>${r.produit > 1 ? `<span class="badge">×${r.produit} par cuisson</span>` : ""}</header>
        <ul>${r.ingredients.map((i) => `<li>${i.qte > 1 ? `<b>${i.qte}×</b> ` : ""}${echapper(i.nom)}</li>`).join("")}</ul>
        <div class="stepper"><button data-pas="-1" ${n ? "" : "disabled"} aria-label="Moins">−</button><span>${n}</span><button data-pas="1" aria-label="Plus">+</button></div></article>`;
    }).join("") : '<div class="vide">Aucune recette ne correspond.</div>';
  };
  $("#recherche", zone).addEventListener("input", (e) => { recherche = e.target.value; dessinerGrille(); });
  zone.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pas]"); if (!b) return;
    const id = b.closest(".recette").dataset.id;
    choix.set(id, Math.max(0, (choix.get(id) || 0) + Number(b.dataset.pas)));
    if (!choix.get(id)) choix.delete(id);
    sauver(); dessinerGrille(); dessinerBesoins();
  });
  dessinerGrille(); dessinerBesoins();
}

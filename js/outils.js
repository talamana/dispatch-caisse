// Outils communs : formats, dates, fenêtres, formulaires, listes modifiables.

// --- Argent (centimes) ---------------------------------------------------------------------
export function fmt(c) {
  c = Math.round(Number(c) || 0);
  const signe = c < 0 ? "-" : "";
  c = Math.abs(c);
  const dollars = Math.floor(c / 100), cents = c % 100;
  let t = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (cents) t += "," + String(cents).padStart(2, "0");
  return `${signe}${t} $`;
}
export function versCentimes(texte) {
  const v = parseFloat(String(texte ?? "").replace(/\s/g, "").replace("$", "").replace(",", "."));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
export const enDollars = (c) => (c == null ? "" : String(Number(c) / 100).replace(".", ","));
export function pourcent(t) {
  const v = Number(t) * 100;
  return (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1).replace(".", ",")) + " %";
}

// --- Texte -----------------------------------------------------------------------------------
export const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, racine = document) => racine.querySelector(sel);
export const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

// --- Dates (heure locale du navigateur = heure du serveur RP) -------------------------------------
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const pad = (n) => String(n).padStart(2, "0");
export function dateFr(iso, heure = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  const j = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return heure ? `${j} ${pad(d.getHours())}:${pad(d.getMinutes())}` : j;
}
export function dateCourte(iso, heure = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` + (heure ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
}
export const moisCourant = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export function decalerMois(m, delta) {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + (mm - 1) + delta;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export const libelleMois = (m) => { const [a, mm] = m.split("-").map(Number); return `${MOIS[mm - 1]} ${a}`; };
export function bornesMois(m) {
  const [a, mm] = m.split("-").map(Number);
  return { debut: new Date(a, mm - 1, 1).toISOString(), fin: new Date(a, mm, 1).toISOString() };
}
// <input type="date|datetime-local"> <-> ISO
export function versChamp(iso, avecHeure) {
  if (!iso) return "";
  const d = new Date(iso);
  const j = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return avecHeure ? `${j}T${pad(d.getHours())}:${pad(d.getMinutes())}` : j;
}
export function depuisChamp(valeur, avecHeure) {
  if (!valeur) return null;
  if (avecHeure) return new Date(valeur).toISOString();
  const [a, m, j] = valeur.split("-").map(Number);
  const maintenant = new Date();
  const memeJour = maintenant.getFullYear() === a && maintenant.getMonth() === m - 1 && maintenant.getDate() === j;
  return (memeJour ? maintenant : new Date(a, m - 1, j, 12, 0)).toISOString();
}

// --- Notifications ----------------------------------------------------------------------------------
export function toast(message, erreur = false) {
  const el = document.createElement("div");
  el.className = "toast" + (erreur ? " erreur" : "");
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), erreur ? 6000 : 3000);
}

// --- Fenêtres ----------------------------------------------------------------------------------------
export function fenetre({ titre, contenu = "", boutons = [], large = false, quandOuverte }) {
  return new Promise((resoudre) => {
    const voile = document.createElement("div");
    voile.className = "voile";
    voile.innerHTML = `<div class="fenetre${large ? " large" : ""}" role="dialog" aria-modal="true">
      <h3>${echapper(titre)}</h3><div class="contenu"></div><div class="actions"></div></div>`;
    const zone = $(".contenu", voile);
    if (typeof contenu === "string") zone.innerHTML = contenu; else zone.appendChild(contenu);
    const fermer = (valeur) => { voile.remove(); document.removeEventListener("keydown", clavier); resoudre(valeur); };
    const clavier = (e) => { if (e.key === "Escape") fermer(null); };
    document.addEventListener("keydown", clavier);
    voile.addEventListener("mousedown", (e) => { if (e.target === voile) fermer(null); });
    for (const b of boutons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "btn" + (b.classe ? " " + b.classe : "");
      el.textContent = b.texte;
      el.addEventListener("click", async () => {
        if (!b.action) return fermer(b.valeur ?? null);
        el.disabled = true;
        try {
          const r = await b.action(zone);
          if (r !== false) fermer(r === undefined ? true : r);
        } catch (err) { toast(messageErreur(err), true); } finally { el.disabled = false; }
      });
      $(".actions", voile).appendChild(el);
    }
    document.body.appendChild(voile);
    quandOuverte?.(zone, fermer);
    // focus sur le 1er champ, sauf si l'utilisateur est déjà dans un champ de la fenêtre
    const premier = () => { if (!voile.contains(document.activeElement)) $("input:not([type=hidden]), select, textarea", zone)?.focus(); };
    premier(); setTimeout(premier, 30);
  });
}
export async function confirmer(message, texte = "Confirmer", classe = "principal") {
  return !!(await fenetre({ titre: "Confirmer", contenu: `<p>${echapper(message)}</p>`,
    boutons: [{ texte: "Annuler" }, { texte, classe, valeur: true }] }));
}

// --- Erreurs de la base, en clair ---------------------------------------------------------------------
export function messageErreur(err) {
  const code = err?.code, msg = err?.message || String(err);
  if (code === "23505") return "Ça existe déjà (nom ou numéro en double).";
  if (code === "42501" || code === "PGRST301" || /JWT|permission denied/i.test(msg)) return "Accès refusé : reconnecte-toi avec le code gérant.";
  if (code === "23503") return "Impossible : cet élément est utilisé ailleurs.";
  if (code === "23514") return "Valeur refusée (montant ou choix invalide).";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Pas de connexion à la base. Réessaie dans un instant.";
  return msg;
}

// --- Formulaires générés --------------------------------------------------------------------------------
// champ : { nom, libelle, type: texte|zone|nombre|argent|date|dateheure|choix|case, options: [[valeur, libellé]],
//           requis, aide, plein, min, max, defaut }
export function formulaire(champs, valeurs = {}) {
  const f = document.createElement("form");
  f.className = "form";
  f.addEventListener("submit", (e) => e.preventDefault());
  f.innerHTML = champs.map((c) => {
    const v = valeurs[c.nom] ?? c.defaut;
    const attr = `name="${c.nom}" ${c.requis ? "required" : ""}`;
    let entree;
    switch (c.type) {
      case "zone": entree = `<textarea ${attr} maxlength="${c.max ?? 1000}">${echapper(v ?? "")}</textarea>`; break;
      case "argent": entree = `<input ${attr} inputmode="decimal" placeholder="0" value="${echapper(enDollars(v))}">`; break;
      case "nombre": entree = `<input ${attr} type="number" step="any" ${c.min != null ? `min="${c.min}"` : ""} value="${echapper(v ?? "")}">`; break;
      case "date": entree = `<input ${attr} type="date" value="${versChamp(v, false)}">`; break;
      case "dateheure": entree = `<input ${attr} type="datetime-local" value="${versChamp(v, true)}">`; break;
      case "choix": entree = `<select ${attr}>${(c.options || []).map(([val, lib]) =>
          `<option value="${echapper(val)}" ${String(val) === String(v ?? "") ? "selected" : ""}>${echapper(lib)}</option>`).join("")}</select>`; break;
      case "case": return `<label class="case ${c.plein ? "plein" : ""}"><input type="checkbox" name="${c.nom}" ${v ? "checked" : ""}> ${echapper(c.libelle)}</label>`;
      default: entree = `<input ${attr} maxlength="${c.max ?? 200}" value="${echapper(v ?? "")}" autocomplete="off">`;
    }
    return `<label class="${c.plein || c.type === "zone" ? "plein" : ""}">${echapper(c.libelle)}${c.requis ? " *" : ""}${entree}${c.aide ? `<span class="aide">${echapper(c.aide)}</span>` : ""}</label>`;
  }).join("");
  return f;
}
export function lireFormulaire(f, champs) {
  const o = {};
  for (const c of champs) {
    const el = f.elements[c.nom];
    if (c.type === "case") { o[c.nom] = el.checked; continue; }
    const brut = el.value.trim();
    if (c.requis && !brut) { el.focus(); throw new Error(`« ${c.libelle} » est obligatoire.`); }
    if (c.type === "argent") {
      const v = brut ? versCentimes(brut) : null;
      if (brut && (!Number.isFinite(v) || v < 0)) { el.focus(); throw new Error(`Montant invalide pour « ${c.libelle} ».`); }
      o[c.nom] = v;
    } else if (c.type === "nombre") o[c.nom] = brut === "" ? null : Number(brut);
    else if (c.type === "date") o[c.nom] = depuisChamp(brut, false);
    else if (c.type === "dateheure") o[c.nom] = depuisChamp(brut, true);
    else if (c.type === "choix") o[c.nom] = brut === "" ? null : (/^\d+$/.test(brut) && c.entier ? Number(brut) : brut);
    else o[c.nom] = brut || null;
  }
  return o;
}
export async function formulaireEnFenetre(titre, champs, valeurs, enregistrer, large = false) {
  const f = formulaire(champs, valeurs);
  return fenetre({ titre, contenu: f, large, boutons: [
    { texte: "Annuler" },
    { texte: "Enregistrer", classe: "principal", action: async () => { await enregistrer(lireFormulaire(f, champs)); } },
  ], quandOuverte: () => f.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); f.closest(".fenetre").querySelector(".actions .principal").click(); }
  }) });
}

// --- Rendu de tableau ------------------------------------------------------------------------------------
// colonnes : [{ titre, rendu(ligne) -> html, classe }]
export function tableau(lignes, colonnes, { vide = "Rien pour l'instant.", actions, pied } = {}) {
  if (!lignes.length) return `<div class="vide">${echapper(vide)}</div>`;
  return `<div class="table-defile"><table class="liste"><thead><tr>${colonnes.map((c) => `<th class="${c.classe || ""}">${echapper(c.titre)}</th>`).join("")}${actions ? "<th></th>" : ""}</tr></thead>
    <tbody>${lignes.map((l, i) => `<tr data-i="${i}">${colonnes.map((c) => `<td class="${c.classe || ""}">${c.rendu(l)}</td>`).join("")}${actions ? `<td class="actions">${actions(l)}</td>` : ""}</tr>`).join("")}</tbody>
    ${pied ? `<tfoot><tr>${pied}</tr></tfoot>` : ""}</table></div>`;
}
// Relie les boutons data-action="nom" d'un conteneur à des fonctions (ligne = lignes[data-i])
export function brancherActions(conteneur, lignes, gestionnaires) {
  conteneur.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !conteneur.contains(b)) return;
    const tr = b.closest("tr[data-i]");
    const ligne = tr ? lignes()[Number(tr.dataset.i)] : null;
    const f = gestionnaires[b.dataset.action];
    if (!f) return;
    // anti double-clic, sans jamais laisser un bouton bloqué (fenêtre ouverte, page rechargée…)
    if (b.dataset.occupe) return;
    b.dataset.occupe = "1";
    const liberer = () => { delete b.dataset.occupe; };
    const minuterie = setTimeout(liberer, 1500);
    try { await f(ligne, b); } catch (err) { toast(messageErreur(err), true); } finally { clearTimeout(minuterie); liberer(); }
  });
}

export const TYPES_CLIENT = {
  particulier: "Particulier", entreprise: "Entreprise", auto_entreprise: "Auto-entreprise", micro_entreprise: "Micro-entreprise",
  association: "Association", parti_politique: "Parti politique", syndicat: "Syndicat",
};
export const CATEGORIES_DEPENSE = {
  matieres_premieres: "Matières premières", services: "Services", essence: "Essence",
  fournitures: "Fournitures (entreprises de San Andreas)", autre: "Autre — justificatif + validation Mairie", non_deductible: "Non déductible",
};
export const BENEFICIAIRES = { association: "Association", parti_politique: "Parti politique", syndicat: "Syndicat" };
export const NATURES_DON = { monetaire: "Monétaire", bien_service: "Bien ou service" };
export const options = (dico) => Object.entries(dico);

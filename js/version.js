// Le site version 2 a besoin de la base version 2 (Supabase > SQL Editor > mise_a_jour_v2.sql).
// Tant que la base n'est pas passée en version 2, on ouvre l'ancien site (dossier « ancien/ »), qui marche avec elle.
(function () {
  var C = window.DISPATCH;
  if (!C || C.essai) return;
  fetch(C.url + "/rest/v1/rpc/version_schema", {
    method: "POST", headers: { apikey: C.cle, "Content-Type": "application/json" }, body: "{}",
  }).then(function (r) { if (r.status === 404) location.replace("ancien/" + location.hash); })
    .catch(function () { /* base injoignable : on reste ici */ });
})();

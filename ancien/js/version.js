// Ancien site (version 1), gardé tant que la base n'est pas passée en version 2.
// Dès que la base est en version 2, on retourne sur le nouveau site.
(function () {
  var C = window.DISPATCH;
  if (!C) return;
  fetch(C.url + "/rest/v1/rpc/version_schema", {
    method: "POST", headers: { apikey: C.cle, "Content-Type": "application/json" }, body: "{}",
  }).then(function (r) { if (r.ok) location.replace("../" + location.hash); })
    .catch(function () { /* base injoignable : on reste ici */ });
})();

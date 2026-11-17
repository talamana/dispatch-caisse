-- Données FICTIVES pour la version de test (jamais envoyées sur la vraie base).
update reglages set entreprise = 'Le Dispatch', sous_titre = 'VERSION DE TEST — données fictives' where id = 1;
insert into acces (id, code_hash) values (1, extensions.crypt('pizza', extensions.gen_salt('bf'))) on conflict (id) do nothing;

-- Logements (stock de base)
insert into logements (nom, gerant, ordre) values ('Appartement Vinewood', 'Tony Russo', 1), ('Maison Sandy Shores', 'Mia Costa', 2);

-- Prix d'exemple (fictifs) : supérette / maraîcher / Raven-Sunny, niveau à garder, logement habituel
with p (nom, sup, mar, fou, base, logement) as (values
  ('Pot de lait entier', 400, null, 200, 300, 'Maison Sandy Shores'),
  ('Farine',             300, null, 200, 200, 'Appartement Vinewood'),
  ('Sucre',              200, null, 100, 200, 'Appartement Vinewood'),
  ('Oeuf',               200, 100,   100,  150, 'Appartement Vinewood'),
  ('Chocolat Candybox',  500, null, 300, 100, 'Maison Sandy Shores'),
  ('Cuisse de volaille', 600, null, 400, 80,  'Maison Sandy Shores'),
  ('Steak haché',        600, null, 400, 80,  'Maison Sandy Shores'),
  ('Pain à burger',      200, null, 100, 60,  'Appartement Vinewood'),
  ('Fromage',            300, null, 200, 100, 'Maison Sandy Shores'),
  ('Pomme',              200, 100,   null, 100, 'Appartement Vinewood'),
  ('Orange',             200, 100,   null, 100, 'Appartement Vinewood'),
  ('Fraise',             200, 100,  null, 100, 'Appartement Vinewood'),
  ('Pomme de terre',     100, 100,   null, 150, 'Maison Sandy Shores'),
  ('Tomate',             100, 100,   null, 100, 'Maison Sandy Shores'),
  ('Citron',             100, 100,   null, 60,  'Appartement Vinewood'),
  ('Café en grains',     400, null, 200, 60,  'Appartement Vinewood'),
  ('Pot de miel',        500, null, 300, 40,  'Appartement Vinewood'),
  ('Bouteille d''eau',   100, null, 100,  100, 'Appartement Vinewood'),
  ('Saucisse de porc',   500, null, 300, 40,  'Maison Sandy Shores'),
  ('Pâte',               null, null, null, 40, 'Appartement Vinewood'))
update ingredients i set prix_superette = p.sup, prix_maraicher = p.mar, prix_fournisseur = p.fou, stock_base = p.base,
       fournisseur = case when p.fou is not null then 'Raven' end,
       logement_id = (select id from logements where nom = p.logement)
  from p where i.nom = p.nom;
update ingredients set fournisseur = 'Sunny' where nom in ('Chocolat Candybox', 'Café en grains', 'Pot de miel');

-- Ingrédient combiné d'exemple (fictif) : la Pâte se fabrique
update ingredients set composition = '[{"nom": "Farine", "qte": 2}, {"nom": "Oeuf", "qte": 1}, {"nom": "Bouteille d''eau", "qte": 1}]',
       produit = 4, note = 'Exemple fictif : 2 Farine + 1 Oeuf + 1 Bouteille d''eau = 4 Pâtes'
 where nom = 'Pâte';

-- Stock compté (fictif)
insert into stocks (ingredient, logement_id, quantite)
select i.nom, l.id, q.qte from (values
  ('Pot de lait entier', 'Maison Sandy Shores', 250), ('Farine', 'Appartement Vinewood', 120), ('Farine', 'Maison Sandy Shores', 30),
  ('Sucre', 'Appartement Vinewood', 180), ('Oeuf', 'Appartement Vinewood', 60), ('Chocolat Candybox', 'Maison Sandy Shores', 45),
  ('Cuisse de volaille', 'Maison Sandy Shores', 25), ('Steak haché', 'Maison Sandy Shores', 30), ('Pain à burger', 'Appartement Vinewood', 30),
  ('Fromage', 'Maison Sandy Shores', 40), ('Pomme', 'Appartement Vinewood', 70), ('Orange', 'Appartement Vinewood', 50),
  ('Fraise', 'Appartement Vinewood', 35), ('Pomme de terre', 'Maison Sandy Shores', 90), ('Tomate', 'Maison Sandy Shores', 40),
  ('Citron', 'Appartement Vinewood', 20), ('Café en grains', 'Appartement Vinewood', 25), ('Pot de miel', 'Appartement Vinewood', 12),
  ('Bouteille d''eau', 'Appartement Vinewood', 80), ('Saucisse de porc', 'Maison Sandy Shores', 15), ('Pâte', 'Appartement Vinewood', 8)
) q (nom, logement, qte) join ingredients i on i.nom = q.nom join logements l on l.nom = q.logement;

-- Clients (fictifs)
insert into clients (nom, type, facturation_hebdo, telephone) values
  ('Bean Machine', 'entreprise', true, '555-0142'), ('Benny''s Motorworks', 'entreprise', false, '555-0177'),
  ('Weazel News', 'entreprise', false, null), ('Jessica Taylor', 'particulier', false, '555-0101');

-- Commandes de la SEMAINE DERNIÈRE (à facturer lundi : mairies + Bean Machine)
do $$
declare v jsonb;
begin
  v := encaisser('{"uid": "demo-1", "vendeur": "Tony Russo", "client": "LSPD", "tarif": "public", "lignes": [{"id": "cadet", "qte": 4}, {"id": "p_limonade", "qte": 4}]}');
  update ventes set date = debut_semaine() - interval '5 days' + interval '13 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-2", "vendeur": "Mia Costa", "client": "LSPD", "tarif": "public", "lignes": [{"id": "recrue", "qte": 6}]}');
  update ventes set date = debut_semaine() - interval '3 days' + interval '20 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-3", "vendeur": "Tony Russo", "client": "SAMS", "tarif": "public", "lignes": [{"id": "medecin", "qte": 5}, {"id": "p_cafe_miel", "qte": 5}]}');
  update ventes set date = debut_semaine() - interval '4 days' + interval '12 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-4", "vendeur": "Mia Costa", "client": "LSCS", "tarif": "public", "lignes": [{"id": "deputy", "qte": 3}]}');
  update ventes set date = debut_semaine() - interval '2 days' + interval '15 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-5", "vendeur": "Tony Russo", "client": "Bean Machine", "tarif": "normal", "lignes": [{"id": "p_cookie", "qte": 10}, {"id": "p_donut", "qte": 10}]}');
  update ventes set date = debut_semaine() - interval '6 days' + interval '10 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-6", "vendeur": "Mia Costa", "client": "Jessica Taylor", "tarif": "normal", "lignes": [{"id": "sergent", "qte": 2}]}');
  update ventes set date = debut_semaine() - interval '1 days' + interval '19 hours', cuisine = 'servie' where id = (v ->> 'vente_id')::bigint;
  update recettes r set date = v2.date from ventes v2 where v2.recette_id = r.id;
  -- commandes de CETTE SEMAINE, encore en cuisine
  v := encaisser('{"uid": "demo-7", "vendeur": "Tony Russo", "client": "LSDWP", "tarif": "public", "lignes": [{"id": "cadet", "qte": 2}, {"id": "p_cafe_liegeois", "qte": 2}]}');
  update ventes set date = now() - interval '25 minutes' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-8", "vendeur": "Mia Costa", "tarif": "normal", "lignes": [{"id": "cadet", "qte": 4}, {"id": "sergent", "qte": 3}, {"id": "recrue", "qte": 2}, {"id": "p_chocolat_chaud", "qte": 2}, {"id": "p_fondant", "qte": 1}]}');
  update ventes set date = now() - interval '12 minutes' where id = (v ->> 'vente_id')::bigint;
  v := encaisser('{"uid": "demo-9", "vendeur": "Tony Russo", "client": "Benny''s Motorworks", "tarif": "normal", "lignes": [{"id": "officier", "qte": 2}, {"id": "p_cheeseburger", "qte": 1}]}');
  update ventes set date = now() - interval '4 minutes' where id = (v ->> 'vente_id')::bigint;
  update recettes r set date = v2.date from ventes v2 where v2.recette_id = r.id;
end $$;
insert into reserve_plats (recette_id, portions) values ('chocolat_chaud', 1) on conflict (recette_id) do nothing;

-- Achats : Raven (semaine dernière, à payer), Sunny (cette semaine), supérette avancée par un gérant
do $$
declare vine bigint := (select id from logements where nom = 'Appartement Vinewood');
        sandy bigint := (select id from logements where nom = 'Maison Sandy Shores');
begin
  perform enregistrer_achat(jsonb_build_object('fournisseur', 'Raven', 'paiement', 'semaine', 'logement_id', vine,
    'date', debut_semaine() - interval '4 days' + interval '16 hours',
    'lignes', '[{"nom": "Farine", "qte": 80, "prix": 200}, {"nom": "Sucre", "qte": 60, "prix": 100}, {"nom": "Oeuf", "qte": 40, "prix": 100}]'::jsonb));
  perform enregistrer_achat(jsonb_build_object('fournisseur', 'Raven', 'paiement', 'semaine', 'logement_id', sandy,
    'date', debut_semaine() - interval '2 days' + interval '11 hours',
    'lignes', '[{"nom": "Pot de lait entier", "qte": 100, "prix": 200}, {"nom": "Steak haché", "qte": 30, "prix": 400}]'::jsonb));
  perform enregistrer_achat(jsonb_build_object('fournisseur', 'Sunny', 'paiement', 'semaine', 'logement_id', sandy,
    'lignes', '[{"nom": "Chocolat Candybox", "qte": 30, "prix": 300}, {"nom": "Café en grains", "qte": 20, "prix": 200}]'::jsonb));
  perform enregistrer_achat(jsonb_build_object('fournisseur', 'Supérette', 'paiement', 'avance', 'avance_par', 'Tony Russo',
    'logement_id', vine, 'date', now() - interval '1 day',
    'lignes', '[{"nom": "Citron", "qte": 10, "prix": 100}, {"nom": "Pot de miel", "qte": 4, "prix": 500}]'::jsonb));
  perform enregistrer_achat(jsonb_build_object('fournisseur', 'Supérette', 'paiement', 'avance', 'avance_par', 'Mia Costa',
    'logement_id', sandy, 'date', now() - interval '3 days',
    'lignes', '[{"nom": "Fromage", "qte": 10, "prix": 300}]'::jsonb));
end $$;
-- les achats ci-dessus ont été ajoutés au stock compté : on garde les quantités d'exemple
update stocks s set quantite = s.quantite - coalesce((select sum((l ->> 'qte')::numeric) from achats a, jsonb_array_elements(a.lignes) l
  where a.logement_id = s.logement_id and l ->> 'nom' = s.ingredient), 0);
delete from stocks where quantite = 0;
update stocks set quantite = 250 where ingredient = 'Pot de lait entier';

-- Un peu de compta du mois (fictif)
insert into depenses (date, montant, categorie, fournisseur, description) values
  (now() - interval '6 days', 12000, 'essence', 'Station LTD', 'Plein du camion de livraison'),
  (now() - interval '9 days', 25000, 'services', 'Benny''s Motorworks', 'Réparation du camion');

-- Historique fictif : commandes déjà livrées (avec qui a livré) et quelques cuissons
update ventes set livre_par = case when id % 2 = 0 then 'Mia Costa' else 'Tony Russo' end,
                  cuisine_le = date + interval '45 minutes'
 where cuisine = 'servie';
insert into journal_cuisine (date, recette_id, nom, fois, portions, par)
select now() - interval '2 hours', id, nom, 2, 2 * produit, 'Mia Costa' from recettes_cuisine where id in ('boite_de_nuggets', 'compote', 'steak_frites');
insert into journal_cuisine (date, recette_id, nom, fois, portions, par)
select now() - interval '1 day', id, nom, 3, 3 * produit, 'Tony Russo' from recettes_cuisine where id in ('crepe', 'crepe_au_chocolat', 'limonade_a_la_pomme');

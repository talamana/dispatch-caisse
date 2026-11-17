-- Services publics et mairies qui reçoivent leurs factures (relançable : ne modifie pas un réglage déjà changé).
insert into clients (nom, type) values
  ('Mairie de Los Santos', 'service_public'), ('Mairie de Blaine County', 'service_public'),
  ('LSPD', 'service_public'), ('SAMS', 'service_public'), ('LSCS', 'service_public'), ('LSDWP', 'service_public')
on conflict ((lower(trim(nom)))) do nothing;

update clients c set type = 'service_public', facturation_hebdo = true,
       facture_a = (select id from clients where lower(trim(nom)) = 'mairie de los santos')
 where lower(trim(c.nom)) in ('lspd', 'sams') and c.facture_a is null;

update clients c set type = 'service_public', facturation_hebdo = true,
       facture_a = (select id from clients where lower(trim(nom)) = 'mairie de blaine county')
 where lower(trim(c.nom)) in ('lscs', 'lsdwp') and c.facture_a is null;

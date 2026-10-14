-- Generated from Shop_Payee_List.xlsx — bank/email left NULL (encrypted-ready columns exist)
-- OWNER_UI §B: these rows are NOT shops. Migration 20261014_repair_shop_master_entity.sql
-- soft-removes them from repair.shops and copies marks into repair.billing_roads.
-- Do not add new payee/railroad rows here — use billing_roads / shop master create instead.
BEGIN;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A001', 'TTX Company', '93167 Network Place | Lockbox # 93167 | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A004', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A009', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A010', 'Harbor Rail Services', '1550 W. Colorado Blvd | Pasadena, CA | US | 91105', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A012', 'Road and Rail Services Inc', '4233 Bardstown Road | Suite 200 | Louisville, KY | US | 40218', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A025', 'TMC Engineering Services, Inc.', '2335 Wadsworth | Houston, TX | US | 77015', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A028', 'TNT Railcar Services, Inc.', 'PO Box 10142 | Longview, TX | US | 75608', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A030', 'RCS Transportation', '122 Citizens Blvd | Simpsonville, KY | US | 40067', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A033', 'The Andersons', 'PO Box 84878 | Chicago, IL | US | 60689-4878', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A048', 'Diversified Mechanical Services', 'PO Box 6108-030 | Hermitage, PA | US | 16148', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A056', 'Total Trans Care, Inc.', '600 Demers Ave. | 5th Floor | Grand Forks, ND | US | 58201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A063', 'South Texas Railcar', 'PO Box 128 | St. Hedwig, TX | US | 78152', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A064', 'Canpotex', '409 - Third Avenue South | Suite 700 | Saskatoon, SK | CA | S7K 5R5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A065', 'Inter-Rail Transport, Inc.', '115 Lawyers Row | Centreville, MD | US | 21617', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A066', 'Traditional Logistics & Cartage LLC', '122 Citizens Blvd | Simpsonville, KY | US | 40067', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A072', 'DLG Industrias Sa de Cv', 'PO Box 659506 | San Antonio, TX | US | 78265-9506', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A078', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A084', 'Cathcart Rail, LLC - RUNNING REPAIR AGENT', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A085', 'Blue Collar Trades LLC', '255 North 270 East | Vineyard, UT | US | 84059', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A093', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A095', 'Coastal Railcar Services LLC', '4308 Albany Ave | Waresboro, GA | US | 31564', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A096', 'Motive Power Technical Services', '108 N 7th St | Reedsport, OR | US | 97467', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A102', 'Motive Power Technical Services', '108 N 7th St | Reedsport, OR | US | 97467', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A106', 'St. Marys Railroad, LLC', 'PO Box 2267 | Fairhope, AL | US | 36533', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A108', 'R.J. Corman Railroad', 'PO Box 788 | Nicholasville, KY | US | 40340', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A110', 'Titan Transportation Services', '122 Citizens Blvd | Simpsonville, KY | US | 40067', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AA', 'Ann Arbor Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ABS', 'Alabama Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AERC', 'Albany & Eastern Railroad', '263 Industrial Way | Lebanon, OR | US | 97355', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AKMD', 'Arkansas Midland Railroad Co.', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ALE', 'Alabama Export Railroad', '4519 Mcinnis Ave | Moss Point, MS | US | 39563', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ALM', 'Arkansas Louisiana & Mississippi Railroad Company', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ALS', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'APA', 'Apache Railway Company', 'PO Box 857 | Snowflake, AZ | US | 85937', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARR', 'Alaska Railroad Corp', 'PO Box 100520 | Anchorage, AK | US | 99510-0520', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARS', 'Arkansas Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ASRY', 'Ashland Railway, Inc.', '6055D Kellers Church Road | Pipersville, PA | US | 18947', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AWRR', 'Austin Western Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AZER', 'Arizona Eastern Railway Company', '27603 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BBAY', 'Bogalusa Bayou Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BDW', 'Bighorn Divide and Wyoming Railroad', '701 E. 1st St. | PO Box 387 | Shoshoni, WY | US | 82649', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BHRR', 'Birmingham Terminal Railway  LLC', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BJRY', 'Burlington Junction Railway', '1510 Bluff Rd | PO Box 37 | Burlington, IA | US | 52601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BLE', 'Bessemer and Lake Erie Railroad', 'PO Box 95361 | Chicago, IL | US | 60694-5361', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BLU', 'Blue Ridge Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BNSF', 'BNSF Railway', '3115 Solutions Center | Chicago, IL | US | 60677-3001', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BPRR', 'Buffalo & Pittsburgh Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BRC', 'Belt Railway Company', 'PO Box 67 | Bedford Park, IL | US | 60499-0067', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BRG', 'Brownsville & Rio Grande Railway', 'PO Box 912979 | Denver, CO | US | 80291 2979', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BRS', 'Baton Rouge Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BVRR', 'Boise Valley Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C369', 'Mid-West Railcar Services', '714 Briarwood Road | Saskatoon, SK | CA | S7V 1C4', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C803', 'Elite Railcar Repair LLC', '305 E Tiffin St | Attica, OH | US | 44807', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C886', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CBNS', 'Cape Breton & Central Nova Scotia Railway', '9001 Boul. de L''Acadie | Suite 600 | Montreal, QC | CA | H4N 3H5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CBR', 'Coos Bay Rail Line', '125 Central Avenue | Suite 300 | Coos Bay, OR | US | 97420', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CBRW', 'Columbia Basin Railroad Company', '111 University Parkway | Suite 200 | Yakima, WA | US | 98901', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CC', 'Chicago Central and Pacific Railroad', 'PO Box 95361 | Chicago, IL | US | 60694-5361', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CCLX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CEFX', 'The CIT Group/Capital Finance, Inc.', 'c/o First Citizens Bank & Trust | P O Box 8628 | Carol Stream, IL | US | 60197-8628', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CIC', 'Cedar Rapids & Iowa City Railroad', '2020 Lefebure Rd Sw | Fairfax, IA | US | 52228', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CIRR', 'Chattahoochee Industrial Railroad', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CMQ', 'Central Maine and Quebec Railway', 'PO Box 1289 Main Post Office | Winnipeg, MB | CA | R3C 2Z1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CN', 'Canadian National', 'Non-Freight Management | PO BOX 71351 | Chicago, IL | US | 60694-1351', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CORP', 'Central Oregon & Pacific Railroad, Inc.', '27603 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CP', 'Canadian Pacific Railway', 'PO Box 1289, Main Post Office | Winnipeg, MB | CA | R3C 2Z1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CRGX', 'Cargill c/o Alltranstek LLC', '1101 West 31st Street | Suite 200 | Downers Grove, IL | US | 60515', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CRL', 'Chicago Rail Link Railroad', 'P O Box 912979 | Denver, CO | US | 80291 2979', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CSS', 'Chicago South Shore Railroad', '6990 Reliable Parkway | Chicago, IL | US | 60686', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CSXT', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CTN', 'Canton Railroad Company', '1841 S. Newkirk Street | Baltimore, MD | US | 21224', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CUOH', 'Columbus & Ohio River Rail Road', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CVR', 'Cimarron Valley Railroad', '1027 S. Main St., Suite 403 | Joplin, MO | US | 64801', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CW', 'Colorado and Wyoming Railway', 'PO Box 734136 | Dallas, TX | US | 75373  413', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CWRO', 'Cleveland Cliffs Steel', '25465 Network Place | Chicago, IL | US | 60673-1254', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D081', 'Watco Companies', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D288', 'Petroleum Service Corporation', 'PO Box 734873 | Dallas, TX | US | 75373-4873', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DAIR', 'D & I Railroad', 'Sds-12-2515, PO Box 86 | Minneapolis, MN | US | 55486', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DC', 'Delray Connecting Railroad', '900 Thompson Run Road | Monroeville, PA | US | 15146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DH', 'Delaware & Hudson Railway Company Inc.', '8293 Collection Center Drive. | Chicago, IL | US | 60693-0082', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DJJX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DME', 'Dakota Minnesota and Eastern Railroad', '8293 Collection Center Drive. | Chicago, IL | US | 60693-0082', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DQE', 'Dequeen & Eastern Railroad LLC', 'PO Box 8442 | Boston, MA | US | 02284-4245', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DREI', 'Decatur & Eastern Illinois Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EAMX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EIRR', 'Eastern Idaho Railroad LLC', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ELS', 'Escanaba & Lake Superior Railroad Company', 'One Larkin Plaza | Wells, MI | US | 49894', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EVWR', 'Evansville Western Railway', 'PO Box 403943 | Atlanta, GA | US | 30384-3943', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FCRD', 'First Coast Railroad', '27604 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FEC', 'Florida East Coast Railway', 'PO Box 743068 | Atlanta, GA | US | 30374 3068', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FGLK', 'Finger Lakes Railway', 'PO Box 1750 | Clinton, OK | US | 73601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FOXY', 'Fox Valley & Lake Superior Rail System', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FSRR', 'Ferrosur, S.A. de C.V.', 'c/o Citibank N.A., Acct. #36794009 | 111 Wall Street | New York, NY | US | 10043', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FURX', 'Wells Fargo Rail', 'PO Box 60546 | Charlotte, NC | US | 28260-0546', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FXE', 'Ferrocarril Mexicano S.A. De C.V.', '131 S Dearborn - 6th Floor | Lock Box 26502 | Chicago, IL | US | 60603', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GATX', 'GATX Corporation', '3454 Solutions Center | Chicago, IL | US | 60677-3004', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GDLK', 'Grand Elk Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GLC', 'Great Lakes Central Railroad', 'PO Box 550 | Owosso, MI | US | 48867-0550', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GMRC', 'Green Mountain Railroad', 'One Railway Lane | Burlington, VT | US | 5401', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GNBC', 'Grainbelt Corporation', 'PO Box 1750 | Clinton, OK | US | 73601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GOOS', 'Goose Lake Railway LLC', '1410 S 3rd St | Lakeview, OR | US | 97630', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GRNW', 'Great Northwest Railroad LLC', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GTRA', 'Golden Triangle Railroad LLC', 'PO Box 844245 | Boston, MA | US | 02284-4245', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GTW', 'Grand Trunk Western', 'PO Box 95361 | Chicago, IL | US | 60694-5361', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HCRY', 'Huron Central Railway', '9001 Boul. de L''Acadie | Suite 600 | Montreal, QC | CAN | H4N 3H5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HESR', 'Huron & Eastern Ry Co', '27596 Network Place | Chicago, IL | US | 60673-1275', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HROX', 'Hanson Aggregates LLC', '300 E John Carpenter Frwy | Suite 1600 | Irving, TX | US | 75062', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IAIS', 'Iowa Interstate Railroad Ltd.', '203 2nd Street, Suite 500 | Cedar Rapids, IA | US | 52401', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IC', 'Illinois Central', 'PO Box 95361 | Chicago, IL | US | 60694-5361', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IHB', 'Indiana Harbor Belt Railroad', 'P O Box 71922 | Chicago, IL | US | 60694-1922', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'INRD', 'Indiana Railroad', 'PO Box 858741 | Minneapolis, MN | US | 55485', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IORY', 'Indiana & Ohio Railway', '27596 Network Place | Chicago, IL | US | 60673-1275', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ISRR', 'Indiana Southern Railroad, Inc.', '27596 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ITFX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'JVRR', 'Juniata Valley Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KAW', 'Kaw River Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KBSR', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KCS', 'Kansas City Southern Railway Company', 'PO Box 74007465 | Chicago, IL | US | 60674-7465', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KCSM', 'Kansas City Southern de Mexico S.A. de C.V.', 'Kansas City Southern - 3rd Floor | PO Box 219335 | Kansas City, MO | US | 64121-9335', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KNWA', 'Kanawha River Railroad LLC', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KO', 'Kansas & Oklahoma Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KYLE', 'Kyle Railroad Company', '27596 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LBWR', 'Lubbock Western Railway', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LDRR', 'Louisiana & Delta Railroad', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LSRC', 'Lake State Railway Company', '750 N. Washington Ave. | Saginaw, MI | US | 48607', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LVRB', 'Lehigh Valley Rail Management', '313 E Broad Street | Bethlehem, PA | US | 18018', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LVRR', 'Lycoming Valley Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MALX', 'Mid-America Locomotive & Car Repair', '1601 W Allens Lane | Evansville, IN | US | 47710', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MCER', 'Massachusetts Central Railroad', '850 South Barre Road | PO Box 250 | South Barre, MA | US | 1074', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MMID', 'Maryland Midland Railway, Inc.', '27604 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MMT', 'Mission Mountian Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MNN', 'Minnesota Northern Railroad', 'PO Box 826 | Crookston, MN | US | 56716', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MNNR', 'Minnesota Commercial Railway Co', '508 Cleveland Ave North | St. Paul, MN | US | 55114', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MRL', 'Montana Rail Link, Inc.', 'PO Box 16390 | Missoula, MT | US | 59808', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MSE', 'Mississippi Export Railroad', '4519 Mcinnis Ave | Moss Point, MS | US | 39563', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MSR', 'Mississippi Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MSTR', 'Massena Terminal Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NBER', 'Nittany & Bald Eagle Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NBSR', 'New Brunswick Southern Rwy Co., Ltd.', '300 Union Street | 6Th Floor | Saint John, NB | CA | E2L 4Z2', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NCRC', 'Nebraska Central Railroad Co.', '6100 Southwest Blvd. Suite 320 | Fort Worth, TX | US | 76109', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NECR', 'New England Central Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NOGC', 'New Orleans & Gulf Coast Railway', '6100 Southwest Blvd. Suite 320 | Fort Worth, TX | US | 76109', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NOPB', 'New Orleans Public Belt Railroad', '4822 Tchoupitoulas Street | Rout: 021 000 021 Acct: 565 070 351 | New Orleans, LA | US | 70115', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NPR', 'Agassiz Rail Services, Inc.', '600 Demers Ave | 5th Floor | Grand Forks, ND | US | 58201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NS', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NSHR', 'North Shore Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OERR', 'Oregon Eastern', '1027 S. Main St., Suite 403 | Joplin, MO | US | 64801', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OFOX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OMX', 'Midland Railway Supply', '1815 West Delmar Ave. | Godfrey, IL | US | 62035', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ONT', 'Ontario Northland', '555 Oak St. East | North Bay, ON | CA | P1B 8L3', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PAL', 'Paducah & Louisville Railway', 'PO Box 403076 | Atlanta, GA | US | 30384', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PCC', 'Palouse River and Coulee City Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PNWR', 'Portland & Western Railroad', '27603 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'POVA', 'Pend Oreille Valley Railroad', '1981 Black Road | Usk, WA | US | 99180', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRSX', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PSCC', 'Pennsylvania and Southern Railway', 'One Gateway Center | Suite 501B | Newton, MA | US | 2458', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PTRA', 'Port Terminal Railroad Association', 'P O Box 650998 | Dallas, TX | US | 75265', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PW', 'Providence and Worcester Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'QGRY', 'Quebec & Gatineau Railway', '9001 Boul. De L''Acadie | Suite 600 | Montreal, QC | CA | H3N 3H5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RCPE', 'Rapid City, Pierre, and Eastern Railroad', '27596 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RJCM', 'R.J. Corman Railroad', 'PO Box 788 | Nicholasville, KY | US | 40340', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RLK', 'Railink Ottawa Valley', '9001 Boul. De L''Acadie | Suite 600 | Montreal, QC | CA | H4N 3H5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RRVW', 'Red River Valley & Western Railroad', 'P O Box 9201 | Minneapolis, MN | US | 55480-9201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RS', 'Roberval Saguenay Railway', 'Lockbox 915931 | P O Box 4090 Station A | Toronto, ON | CAN | M5W 0E9', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RSR', 'Rochester & Southern Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RVT', 'Rogue Valley Terminal Railroad Corporation', '2095 Avenue F | White City, OR | US | 97503-3210', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SAN', 'Sandersville Railroad Company', 'PO Box 269 | 206 North Smith Street | Sandersville, GA | US | 31082', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SB', 'South Buffalo Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SH', 'Steelton & Highspire Railroad', '25465 Networkplace | Chicago, IL | US | 60673 1254', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SKOL', 'South Kansas and Oklahoma Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SLC', 'San Luis Central Railroad Company', '9501 W. Devon Ave | Rosemont, IL | US | 60018', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SLR', 'St Lawrence and Atlantic Railroad', 'PO Box 95000 | Philiadelphia, PA | US | 19195-0001', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SLWC', 'Stillwater Central Railroad Company LLC', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SOO', 'Soo Line Railroad', '8293 Collection Center Drive. | Chicago, IL | US | 60693-0082', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SRRR', 'Swan Ranch Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SRY', 'Southern Railway of British Columbia Limited', '2102 River Drive | New Westminster, BC | CA | V3M 6S3', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ST', 'Springfield Terminal Railway Inc.', 'P O Box 530192 | Atlanta, GA | US | 30353-0192', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SVGX', 'Savage Services Corp.', 'PO Box 208238 | Dallas, TX | US | 75320', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SVRR', 'Shamokin Valley Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TASD', 'Terminal Rwy Alabama State Docks', 'PO Box 1588 | Mobile, AL | US | 36633', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TCWR', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TN', 'Texas & Northern Railway', '900 Thompson Run Road | Monroeville, PA | US | 15146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TPR', 'Tradepoint Rail, LLC', '6995 Bethlehem Boulevard | Suite 100 | Baltimore, MD | US | 21219-1050', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRRA', 'Terminal Railroad Association of St Louis', 'PO Box 14958-F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TTX', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TZPR', 'Tazewell & Peoria Railroad', '27596 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UCIR', 'Union County Industrial Railroad Company', '356 Priestley Avenue | Northumberland, PA | US | 17857', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UP', 'TTX Company', '22984 Network Place | Chicago, IL | US | 60673-1229', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'URR', 'Union Railroad Company', '900 Thompson Run Road | Monroeville, PA | US | 15146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UTAH', 'Utah Railway', '27603 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UTCX', 'Union Tank Car Company', 'P O Box 91793 | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VR', 'Valdosta Railway', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VSOR', 'Vicksburg Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VTR', 'Vermont Rail System', 'One Railway Lane | Burlington, VT | US | 05401', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WC', 'Wisconsin Central Ltd', 'PO Box 95361 | Chicago, IL | US | 60694-5361', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WE', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WRRC', 'Western Rail Road Co.', '2686 Wald Road | New Braunfels, TE | US | 78132', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WSOR', 'Wisconsin & Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WTJR', 'Wichita, Tillman & Jackson Railway', '6100 Southwest Blvd. Suite 320 | Fort Worth, TX | US | 76109', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'YB', 'Youngstown Belt Railroad', '27606 Network Place | Chicago, IL | US | 60673', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RMTX', 'Rocky Mountain Railcar Repair', '1600 West K Avenue | Tooele, UT | US | 84074', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NIRX', 'Northeastern Illinois Railway Services', 'P O Box 70 | Iroquois, IL | US | 60945', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'YKR', 'York Railway Company', '27604 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ISRY', 'IOWA SOUTHERN RAILWAY COMPANY', '21778 Highview Ave | Lakeville, MN | US | 55044', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AOX', 'Cathcart Rail, LLC - GRAND ISLAND', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R555', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SERA', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A123', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373-2666', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AITX', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CFSX', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RESX', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WFRX', 'Wells Fargo Rail', 'P O Box 60546 | Charlotte, NC | US | 28260-0546', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HRSX', 'Harbor Rail Services', '1550 W. Colorado Blvd | Pasadena, CA | US | 91105', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GRW', 'Gary Railway', '900 Thompson Run Road | Monroeville, PA | US | 15146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D632', 'Dixie Railcar Services', '620 Lakeside Drive | Marston, NC | US | 28363', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MBKX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NFX', 'Cathcart Rail, LLC - DANVILLE', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRDK', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UUX', 'Cranemasters', 'P O Box 645940 | Pittsburgh, PA | US | 15264-5257', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VTX', 'O''Neil Transportation Services', 'P O Box 1107 | Calera, AL | US | 35040', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ALX', 'Cathcart Rail, LLC - AMARILLO/LYNCHBURG', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FRAL', 'Frit Car, Inc.', 'P O Box 534742 | Atlanta, GA | US | 30353-4742', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ROX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AM', 'Arkansas & Missouri Railroad', '306 East Emma | Springdale, AR | US | 72764', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A124', 'SA Rail', 'P O Box 1564 | Maumee, OH | US | 43537', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FKX', 'Cape Fear Railcar', '2100 Bellaire Avenue | Raleigh, NC | US | 27608', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PROX', 'Procor Limited', 'P O Box 6191, Postal Station F | Toronto, ON | CAN | M4Y 2Z2', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VXX', 'Agassiz Rail Services, Inc.', '600 Demers Ave. | 5th Floor | Grand Forks, ND | US | 58201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TILX', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373-2666', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ACR', 'Agawa Canyon Railroad', '315 West 3rd Street | Pittsburg, KS | US | 66762', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'APX', 'Eagle Railcar Services - Roscoe', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GMX', 'Eagle Railcar Services - Longview', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GUX', 'Eagle Railcar Services - Dubois', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GWX', 'Eagle Railcar Services - Gordon', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ONX', 'Eagle Railcar Services - Elkhart', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C519', 'Eagle Railcar Services - Cairo', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C410', 'VLS Environmental Solutions', 'PO Box 4346 | Department 320 | Houston, TX | US | 77210-436', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C547', 'EMS Management', 'P O Box 157 | Denison, TX | US | 75021', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C654', 'Curry Rail Services', '1425 11th Avenue | Altoona, PA | US | 16601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CGLX', 'GATX Rail Canada', '3587 Solutions Center | Chicago, IL | US | 60677-3005', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IDMC', 'International Decal Management Corp', '104 North 11th Street | Rodgers, AR | US | 72756', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MEIX', 'Metro East Industries', 'P O Box 3220 | Fairview Heights, IL | US | 62208', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NKCR', 'Nebraska, Kansas, and Colorado Railway', 'P O Box 912979 | Denver, CO | US | 80291-2979', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRAN', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VPX', 'High Country Railcar', 'P O Box 337 | Timnath, CO | US | 80547', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EJSR', 'Ellwood, Joliet, and Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'QSX', 'Northeastern Illinois Railway Services', 'P O Box 70 | Iroquois, IL | US | 60945', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SCTR', 'South Central Tennessee Railroad', 'P O Box 3295 | Sea Bright, NJ | US | 07760', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRNN', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SPSX', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D658', 'True Rail Enterprises', '629 Tennessee Avenue | Etowah, TN | US | 37331', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UTLX', 'Union Tank Car Company', 'P O Box 91793 | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C568', 'East Carolina Rail, Inc.', 'P O Box 579 | Summerville, SC | US | 29484', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C602', 'Creative Railcar Stenciling', 'P O Box 5450 | Carol Stream, IL | US | 60197-5450', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C635', 'Eagle Railcar Services - Wichita Falls', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D876', 'Curry Rail Services', '1425 11th Avenue | Altoona, PA | US | 16001', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GBRX', 'Greenbrier Management Services', '13820 Collections Center Drive | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'QGX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R333', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RPX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UMX', 'Total Trans Care, Inc.', '600 Demers Ave | 5th Floor | Grand Forks, ND | US | 58201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UWX', 'Rocky Mountain Railcar Repair', '1600 West K Avenue | Tooele, UT | US | 84074', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VDX', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RTX', 'O''Neil Transportation Services', 'P O Box 1107 | Calera, AL | US | 35040', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R365', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MWCX', 'Midwest Railcar Corporation', 'P O Box 776931 | Chicago, IL | US | 60677-6931', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GMHX', 'Holland LP', 'P O Box 7410078 | Chicago, IL | US | 60674-5078', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CRDX', 'Chicago Freight Car', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CFX', 'Liberty Railway Services', '598 North States Avenue | Pueblo West, CO | US | 81007', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C864', 'Southtank Resources', '1135 Worthshire Street | Houston, TX | US | 77008', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C515', 'Railco Repair of Illinois', 'P O Box 184 | Carterville, IL | US | 62918', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C768', 'Cathcart Rail, LLC - BUCYRUS', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WFRC', 'Wells Fargo Rail', 'P O Box 60546 | Charlotte, NC | US | 28260-0546', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D826', 'Savage Services Corp.', 'PO Box 208238 | Dallas, TX | US | 75320', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AHX', 'Kansas City Railcar Services', '1147 South 14th Street | Kansas City, KS | US | 66105', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EVX', 'Excel Railcar Services', '28367 Davis Parkway, Suite 300 | Warrenville, IL | US | 60555', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KRCX', 'R. M. Johnson Company', '890 Norway Drive P O Box J | Annadale, MN | US | 55302', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MULB', 'Mulberry Railcar', 'P O Box 1038 | Mulberry, FL | US | 33860', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SLX', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRWT', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TXN', 'Texas New Mexico Railway', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'YBX', 'Simpson & Sons', '10220 Harrison Avenue | Harrison, OH | US | 45030', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UOX', 'Mountain State Rail Services', 'P O Box 999 | Green River, WY | US | 82935', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R380', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R467', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HRSS', 'Hallett Dock', '710 South 59th Avenue W | Duluth, MN | US | 55807', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SRIX', 'Southwest Rail Industries', 'P O Box 65 | Weimar, TX | US | 78962', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SS01', 'Simpson & Sons', '10220 Harrison Avenue | Harrison, OH | US | 45030', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRGS', 'Trinity Industries Leasing Company', 'P O Box 358041 | Pittsburgh, PA | US | 15251-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AR12', 'AITX Rail Services of Canada', '100 Clark Street | St. Charles, MO | US | 63301', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AR13', 'AITX Railcar Services', 'P O Box 18728F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C760', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C761', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SOXX', 'American Railcar Leasing', 'P O Box 952359 | St. Louis, MO | US | 63195-2359', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KLRX', 'KBX Logistics, LLC', '4111 East 37th Street N | Wichita, KS | US | 67220', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IANR', 'Iowa Northern Railway', '201 Tower Park Drive, Suite 300 | Waterloo, IA | US | 50701', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TAST', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CFFS', 'Cleveland Cliffs Steel', 'P O Box 735146 | Chicago, IL | US | 60673-5146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PAS', 'Pan Am Southern', '200 Meridian Centre, Suite 300 | Rochester, NY | US | 14618', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AEQX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FRRS', 'First Response Rail Service', '646 Main Street | Suite 101 | Port Jefferson, NY | US | 11777', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D680', 'Total Trans Care, Inc.', '600 Demers Ave. | 5th Floor | Grand Forks, ND | US | 58201', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ERSX', 'Excel Railcar Services', '28367 Davis Parkway, Suite 300 | Warrenville, IL | US | 60555', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ERRX', 'Environmental Remediation & Recovery', 'P O Box 266, 400 Industrial Park Road | Mounds, IL | US | 62964', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D934', 'AITX Railcar Services', 'P O Box 18728F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ADMX', 'Archer Daniels Midland Railcar Repair', 'CO/PC 10-96, P O Box 92572 | Chicago, IL | US | 60675', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C440', 'Lakeshore Railcar & Tanker Services', 'P O Box 844245 | Boston, MA | US | 02284', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CHX', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VKX', 'Drumm, Inc.', '4769 Dakota Street SE, Suite 2 | Prior Lake, MN | US | 55372', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TLPX', 'Tank Lining of Paris', 'P O Box 1612 | Paris, TN | US | 38242', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARX', 'Altoona Pipe & Steel Company', 'P O Box 112 | Altoona, PA | US | 16603-0112', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MWR', 'Midwest Railcar Repair', '25965 482nd Avenue | Brandon, SD | US | 57005', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R410', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRX', 'Frontline Railcar Repair', 'Box 598 | Martensville, SK | CAN | S0K 2T0', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DCX', 'Central Gulf Railcar Services', '1120 Papermill Road | Mobile, AL | US | 36610-2514', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VYX', 'The Andersons', 'P O Box 84878 | Chicago, IL | US | 60689-4878', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EUX', 'Alabama Railcar Services', '1796 Jodie Parker Road | Ozark, AL | US | 36360', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A112', 'Longleaf Freight LLC', '582 John L Riegel Road | Rieglewood, NC | US | 28456', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D021', 'Katahdin Railcar Services', '900 Thompson Run Road | Monroeville, PA | US | 15146', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R315', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R154', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D095', 'Longleaf Freight LLC', '582 John L Riegel Road | Rieglewood, NC | US | 28456', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MQT', 'Marquette Rail', '3454 Solutions Center | Chicago, IL | US | 60677-3004', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ITHR', 'Ithica Central Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ETL', 'Essex Terminal Railway', '1600 Tecumseh Road East | Windsor, ON | CAN | N8W 1C5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ZZX', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WOX', 'Cathcart Rail, LLC - MRU', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VVX', 'Cathcart Rail, LLC - ELK MILLS', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FFX', 'Eagle Railcar Services - Junction City', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GSX', 'Eagle Railcar Services - Channlelview', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UAX', 'Beasley Railcar Repair', '252 North State Road 57 | Bloomfield, IL | US | 47424', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C404', 'First Response Rail Service', '646 Main Street | Suite 101 | Port Jefferson, NY | US | 11777', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BHX', 'Central California Railcar Repair', 'P O Box 31062 | Stockton, CA | US | 95213-1062', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OGX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ATX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CDX', 'Metro East Industries', 'P O Box 3220 | Fairview Heights, IL | US | 62208', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WTX', 'Archer Daniels Midland', 'CO/PC 10-96, P O Box 92572 | Chicago, IL | US | 60675', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WATX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRAL', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'VNX', 'Sterling Rail Services', '3405 West 4th Street | Sterling, IL | US | 61801', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRPX', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARSI', 'Alabama Railcar Services', '1796 Jodie Parker Road | Ozark, AL | US | 36360', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '92', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IPX', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R150', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R565', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRSN', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRRW', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CYXX', 'Conrad Yelvington Distributors', '2328 Bellevue Avenue | Daytona Beach, FL | US | 32114', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MNR', 'Maine Northern Railway', 'P O Box 5777 | 6th Floor | Saint John, NB | CAN | E2L 4M3', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D905', 'SA Rail', 'P O Box 1564 | Maumee, PH | US | 43537', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ATW', 'Genesee & Wyoming, Inc.', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'STLX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HBRY', 'Hudson Bay Railway', '728 Bignell Avenue, PO Box 2129 | The Pas, MB | CAN | R9A 1L8', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TMC', 'TMC Engineering Services, Inc.', '2335 Wadsworth | Houston, TX | US | 77015', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TMCX', 'TMC Engineering Services, Inc.', '2335 Wadsworth | Houston, TX | US | 77015', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ECSI', 'Economy Coating Systems', 'P O Box 20 | Camanche, IA | US | 52730', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RYX', 'Idaho Rail Shop', '1785 Kraft Road | Pocatello, ID | US | 83204', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '91', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AR16', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C897', 'C F Rail Services', '425 North Martingale Road | 6th Floor | Shaumburg, IL | US | 60173', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R490', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRAO', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RSI', 'Rail Services, inc.', 'P O Box 35, 646 Gary Johnson Road | Calvert City, KY | US | 42029', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BZX', 'Eagle Railcar Services - Zwolle', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PSFX', 'Precision Rail Services', '4930 Cleves Warsaw Pike | Cincinnati, OH | US | 45238', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C846', 'Eastlake Terminal LLC', '604 North Enterprise Boulevard | Lake Charles, LA | US | 70601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'XEX', 'Ronsco, Inc.', '1440 Saint Catherine Street West | Suite 712 | Montral, QC | CAN | H3G 1R8', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D301', 'Watco Companies', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AZX', 'Bayou Railcar Repair Services', 'P O Box 279 | Holden, LA | US | 70744', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'U109', 'Union Tank Car Company', 'P O Box 91793 | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'U156', 'Union Tank Car Company', 'P O Box 91793 | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'U171', 'Union Tank Car Company', 'P O Box 91793 | Chicago, IL | US | 60693', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BNX', 'Southeastern Railway Services', 'P O Box 72 | Magnolia, MS | US | 39652', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TILC', 'Trinity Industries Leasing Company', 'P O Box 358041 | Pittsburgh, PA | US | 15251-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TISI', 'Trinity Industries Leasing Company', 'P O Box 358041 | Pittsburgh, PA | US | 15251-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MTRX', 'Metro East Industries', 'P O Box 3220 | Fairview Heights, IL | US | 62208', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R377', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CCGX', 'Cando Rail Services', '740 Rosser Avenue, Unit 400 | Brandon, MB | CAN | R7A 0K9', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D937', 'Xpert Rail Mechanical, Inc.', 'P O Box 435 Station Main | Moose Jaw, SK | CAN | S6H 4P1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MDW', 'Minnesota, Dakota & Western Railway', '101 Second Street | International Falls, MN | US | 56649', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MNBR', 'M&B Railroad', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RSX', 'Platinum Rail Division Of BAFI', '394 Sherman Avenue North | Hamilton, ON | CAN | L8L 6P1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A080', 'Ohio Freight Car Services', '3700 Columbus Road NE | Canton, OH | US | 44705', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A094', 'Integrated Railcar Services', 'P O Box 487 | Owings Mills, MD | US | 21117', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A103', 'Steel Line Rail LLC', '6700 Jefferson Highway, Buliding 8 | Baton Rouge, LA | US | 70806', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AOK', 'Arkansas Oklahoma Railroad', '116 West Main | Wilburton, OK | US | 74578', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AZCR', 'Arizona Central Railroad', 'P O Box 1544 | Ogden, UT | US | 84402', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C539', 'Greenbrier GIMSA LLC', 'One Centerpointe Drive Suite 200 | Lake Oswego, OR | US | 97035', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C540', 'Greenbrier Concarril', 'One Centerpointe Drive Suite 200 | Lake Oswego, OR | US | 97035', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C551', 'Tennessee Auto Rack', '114 Mapleton Forest Drive | Cleveland, TN | US | 37312', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C649', 'Freedom Railcar Solutions', 'P O Box 358 | Mustang, OK | US | 73064', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C847', 'Standard Rail Corporation', '330-350 Third Avenue N | Saskatoon, SK | CAN | S7K 6G7', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CADX', 'CAD Railway Services', '155 Montreal-Toronto Highway | Lachine, QC | CAN | H8S 1B4', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CFRR', 'Georgia Florida Railway', 'P O Box 912979 | Denver, CO | US | 90291-2979', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'COP', 'City Of Prineville Railway', '387 NE Third Street | Prineville, OR | US | 97754', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CSO', 'Connecticut Southern Railroad', '27606 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CTRR', 'Cloquet Terminal Railroad', '315 St. Louis Avenue | Cloquet, MN | US | 57720', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D284', 'Greenbrier Central, LLC', 'P O Box 505519 | St. Louis, MO | US | 63150-5519', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D656', 'Illini Rail Solutions', 'P O Box 2113 | Ottawa, IL | US | 61350', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D689', 'TLC Rail Services', '514 East Marion Street | Mishawaka, IN | US | 46545', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D779', 'Savage Gulf Railway', 'P O Box 200312 | Dallas, TX | US | 75320', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D803', 'Steel Line Rail LLC', '6700 Jefferson Highway, Buliding 8 | Baton Rouge, LA | US | 70806', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D918', 'Atlas Railcar. Inc.', '138 Scarlet Drive | Poca, WV | US | 25159', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DUSR', 'Dutchtown Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EARY', 'Eastern Alabama Railway', '27601 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EBSR', 'East Brookfield & Spencer Railroad', '22 Phillip Quinn Memorial Highway | Spencer, MA | US | 01562', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EIX', 'Strozier Railcar Maintenance, Inc.', 'P O Box 2175 | Buna, TX | US | 77612', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FOX', 'OWS Rail Car Inc.', 'P O Box 670 Station B | Sudbury, ON | CAN | P3E 4R6', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FPPX', 'Lower Colorado River Authority', 'P O Box 301142 | Dallas, TX | US | 75303-1142', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GC', 'Georgia Central Railroad', '27604 Network Place | Chicago, IL | US | 60673-1276', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GPX', 'Eagle Railcar Services - Orange', 'P O Box 1579 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GSR', 'Great Sandhills Railway', 'Box 726 | Leader, SK | CAN | S0N 1H0', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'GWRS', 'Great Western Railway LTD', 'Box 669 | Shaunavon, SK | CAN | S0N 2M0', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HRRC', 'Housatonic Railroad Company', 'P O Box 687 | Old Lyme, CT | US | 06371', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'INPR', 'Idaho Northern & Pacific Railroad', '6100 Southwest Boulevard, Suite 320 | Fort Worth, TX | US | 76109', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MGLX', 'Mobil Grain', 'P O Box 3192 | Regina, SK | CAN | S4P 3G7', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OLB', 'Omaha Lincoln & Beatrice Railway', 'P O Box 80268 | Lincoln, NE | US | 68501', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OWSX', 'OWS Rail Car Inc.', 'P O Box 670 Station B | Sudbury, ON | CAN | P3E 4R6', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PR', 'Palmetto Railways', '540 East Bay Street | Charleston, SC | US | 29403', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SXMD', 'Strataflex Midstream', 'P O Box 13925 | Scottsdate, AZ | US | 85267', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TCBR', 'Texas Coastal Bend Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TCT', 'Texas City Terminal Railway', '2335 Wadsworth | Houston, TX | US | 77015', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UZX', 'Dynamic Railcar Services Ltd.', '1044 Montgomery Street | Moose Jaw, SK | CAN | S6H 2X1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WTNN', 'West Tennessee Railroad', 'P O Box 3295 | Sea Bright, NJ | US | 07760', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'YAX', 'Tactical Cleaning Company, LLC', '1700 West Irving Park Road, Suite 310 | Chicago, IL | US | 60613', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C872', 'Bay Worx Rail', '9421 FM 2920 Road, Building 17C | Tomball, TX | US | 77375', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C726', 'Canadian Northern Plains Rail Services', 'P O Box 124 | Lamont, AB | CAN | T0B 2R0', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UFX', 'Eagle Railcar Services - Washington', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LAX', 'EnviroServe, Inc.', 'P O Box 200941 | Dallas, TX | US | 75320-0941', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D161', 'Motive Care & Supply Company', '324 West Mountain View Drive | Hot Springs, AR | US | 71913', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A114', 'Precision Vehicle Logistics', '5402 Moeller Road | Fort Wayne, IN | US | 46806', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'WIX', 'Priority Railcar Services', 'P O Box 85 | South Range, WI | US | 54874', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AVX', 'Texana Tank Car Manufacturing Limited', 'P O Box 550 | Nash, TX | US | 75569', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KZX', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C427', 'South Texas Railcar', 'PO Box 128 | St. Hedwig, TX | US | 78152', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R550', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RPDR', 'Rapid Railcar', '209 McCoury Road | Nottingham, PA | US | 19362', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KHX', 'Economy Coating Systems', 'P O Box 20 | Camanche, IA | US | 52730', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'JVX', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CIR', 'Burlington Junction Railway', '1510 Bluff Rd | PO Box 37 | Burlington, IA | US | 52601', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R327', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R355', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R560', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AR14', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BPX', 'Mid-American Car, Inc.', 'P O Box 33543 | Kansas City, MO | US | 64120', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BWSI', 'Eagle Railcar Services - Washington', 'P O Box 1534 | Eastland, TX | US | 76448', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CWX', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PRWB', 'Progress Rail', '24601 Network Place | Chicago, IL | US | 60673-1246', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'PYX', 'Railcare', '9001 Boul de ''Acadie, Suite 600 | Montreal, QC | CAN | H4N 3H5', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SHX', 'Greenbrier Rail Services', 'PO Box 74007291 | Chicago, IL | US | 60674-7291', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A120', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373-2666', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AR10', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'LAS', 'Louisiana Southern Railroad', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SW01', 'Southwestern Railroad', '1027 South Main Street | Joplin, MO | US | 64801', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SW', 'Southwestern Railroad', '1027 South Main Street | Joplin, MO | US | 64801', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R475', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CTI', 'Caltrax', '1805 30th Avenue SE | Calgary, AB | CAN | T2G 4X8', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CTIX', 'Caltrax', '1805 30th Avenue SE | Calgary, AB | CAN | T2G 4X8', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '9SLR', 'Steel Line Rail LLC', '6700 Jefferson Highway, Buliding 8 | Baton Rouge, LA | US | 70806', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FJX', 'TMC Engineering Services, Inc.', '2335 Wadsworth | Houston, TX | US | 77015', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R482', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'UJX', 'Diversified Mechanical Services', 'PO Box 6108-030 | Hermitage, PA | US | 16148', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ELIX', 'Elite Railcar Repair LLC', '305 E Tiffin St | Attica, OH | US | 44807', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R460', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'NAX', 'AITX Railcar Services', 'P O Box 18728F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OWSA', 'OWS Rail Car Inc.', 'P O Box 670 Station B | Sudbury, ON | CAN | P3E 4R6', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R373', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R675', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R376', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R770', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RMJ', 'R. M. Johnson Company', '890 Norway Drive P O Box J | Annadale, MN | US | 55302', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R580', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R163', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R374', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OFCS', 'Ohio Freight Car Services', '3700 Columbus Road NE | Canton, OH | US | 44705', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CAIX', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, IL | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CFWR', 'RAS Data Services', '1510 Plainfield Road | Suite 3 | Darien, Il | US | 60561-5041', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'THCG', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373-2666', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TFWG', 'T F Warren Company', '57 Old Onondaga Road West | Brantford, ON | CAN | N3T 5M1', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ESRX', 'Excel Railcar Services', '28367 Davis Parkway, Suite 300 | Warrenville, IL | US | 60555', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C826', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C812', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EFDS', 'Equipos Ferroviarios Del Sureste SA de CV', 'c/o Comerica Bank (Carmen M. Mojica) | 411 W. Lafayette, MC 3324 | Detroit, MI | US | 48226', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CZX', 'Midwest Railcar Repair', '25965 482nd Avenue | Brandon, SD | US | 57005', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D829', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R452', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '81', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R345', 'Rescar Companies', 'Rescar Companies | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SUNO', 'EnviroServe, Inc.', 'P O Box 200941 | Dallas, TX | US | 75320-0941', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RBMN', 'Reading Blue Mountain & Northern Railroad', '1 Railroad Boulevard | Port Clinton, PA | US | 19549', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AMIX', 'Railcar Leasing Specialists', 'P O Box 882 | Wilmette, IL | US | 60091', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'JAIX', 'FreightCar America', 'P O Box 95065 | Chicago, IL | US | 60694-5065', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C928', 'Watco Companies', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'OLX', 'DLG Industrias Sa de Cv', 'PO Box 659506 | San Antonio, TX | US | 78265-9506', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D882', 'American Industrial Transport', 'STL W 954374 | 1005 Convention Plaza | St. Louis, MO | US | 63101', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'CCAX', 'Central California Railcar Repair', 'P O Box 31062 | Stockton, CA | US | 95213-1062', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRAM', 'Transco Railway Products', 'P O Box 74007507 | Chicago, IL | US | 60674-7507', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'HZGX', 'Herzog Railroad Services, Inc.', '300 South Fulton | Falls City, NE | US | 68355', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C007', 'Alltranstek, LLC', '1101 West 31st Street | Suite 200 | Downers Grove, IL | US | 60515', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SHPX', 'American Railcar Leasing', 'P O Box 952359 | St. Louis, MO | US | 63195-2359', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A125', 'Priority Yard & Train', '122 Citizens Boulevard | Simpsonville, KY | US | 40067', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BWS', 'BW Services', 'P O Box 816 | Vinton, LA | US | 70668', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BERX', 'Berkshire & Eastern Railroad', '27606 Network Place | Chicago, IL | US | 60673', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AO', 'Appalachian & Ohio Railroad', 'P O Box 277567 | Atlanta, GA | US | 30384', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'IHSB', 'Iron Horse Rail Services', 'P O Box 12746 | Beaumont, TX | US | 77726', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TSCI', 'Triangle Salvage Company Inc.', '409 W. 169th Street | South Holland, IL | US | 60473', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MRXX', 'MRXX Corp.', 'P O Box 33248 | Indialantic, FL | US | 32903', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'FGEX', 'Fruit Growers Express Company', '2565 West 5th Street | Jacksonville, FL | US | 32254', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'AC', 'Algoma Central', 'P O Box 71351 | Chicago, IL | US | 60694-1351', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A099', 'Motive Power Technical Services', '108 North 7th Street | Reedsport, OR | US | 97467', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'SZX', 'Star Railroad LLC', 'P O Box 248 | Green Cove Springs, FL | US | 32043', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C597', 'Estes Railcar Services LLC', '307 Graves Street | Gadsden, AL | US | 35901', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RCRX', 'Reagent Chemical c/o Alltranstek LLC', '1101 West 31st Street | Suite 200 | Downers Grove, IL | US | 60515', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R375', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D283', 'Greenbrier Central, LLC', 'P O Box 505519 | St. Louis, MO | US | 63150-5519', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '85', 'AITX Railcar Services', 'P O Box 18728F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'A127', 'Compass Rail Services LLC', '6185 White Oak Leaf Loop | Conroe, TX | US | 77303', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'KCX', 'Evans Railcar Repair Services', 'P O Box 9426 | Monroe, LA | US | 71211', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'XKX', 'Ohio Freight Car Services', '3700 Columbus Road NE | Canton, OH | US | 44705', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TRRY', 'Gio Railways Corporation', '2 Broadway | Welland, ON | CAN | L3C 2T6', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MEI', 'Metro East Industries', 'P O Box 3220 | Fairview Heights, IL | US | 62208', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EN01', 'EnviroServe, Inc.', 'P O Box 200941 | Dallas, TX | US | 75320-0941', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TXXV', 'Trinity Rail Maintenance Services', 'P O Box 732666 | Dallas, TX | US | 75373-2666', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'DOWX', 'Alltranstek, LLC', '1101 West 31st Street | Suite 200 | Downers Grove, IL | US | 60515', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'EQX', 'Watco Mechanical Services', '39575 Treasury Center | Chicago, IL | US | 60694-9500', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'XMX', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '94', 'AITX Railcar Services', 'P O Box 18728F | St. Louis, MO | US | 63150', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'D858', 'Iron Horse Rail Services', 'P O Box 7406 | Beaumont, TX | US | 77726', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'C524', 'B & R Railroad Services, dba R W Godbey Railroad Services', '2815 Spring Grove Ave. | Cincinnati, OH | US | 45225-2222', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R489', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'BRWV', 'Cathcart Rail, LLC - MRU', 'P O Box 7410811 | Chicago, IL | US | 60674-0811', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'YRC', 'York Railway Company', '27601 Network Place | Chicago, IL | US | 60673', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'STTY', 'Gio Railways Corporation', '2 Broadway | Welland, ON | CAN | L3C 2T6', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'RL1', 'Rail1, LLC', '60 Brandy Lane | Poca, WV | US | 25159', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'R495', 'Rescar Companies', '2882 Paysphere Circle | Chicago, IL | US | 60674', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
INSERT INTO repair.shops (tenant_id, reporting_mark, name, remit_address, default_inbox, routing_number_enc, account_number_enc, email_enc, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'MRC', 'Mid-America Car Inc. - Locomotive', '1523 North Monroe | PO BOX 33543 | Kansas City, MO | US | 64120', NULL, NULL, NULL, NULL, 'seed:payee-list')
ON CONFLICT (tenant_id, reporting_mark) DO UPDATE SET
  name = EXCLUDED.name,
  remit_address = EXCLUDED.remit_address
  WHERE repair.shops.deleted_at IS NULL;
COMMIT;
-- shops upserted: 537

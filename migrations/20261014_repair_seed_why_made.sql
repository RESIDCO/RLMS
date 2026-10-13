-- Generated from Repair_Categories.xlsx sheet WM's
BEGIN;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '01', 'Worn out', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '02', 'Broken', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '03', 'Missing', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '04', 'Defective', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '05', 'Bent', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '06', 'Bent beyond repair', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '07', 'Obsolete', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '08', 'Wrong (not standard to car)', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '09', 'Account repairs', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '10', 'Damaged in removal', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '11', 'Removed in good condition account associated repairs', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '12', 'Inoperative', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '13', 'Attention required per Equipment Advisory', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '14', 'Bulged out', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '15', 'Leaking', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '16', 'Out of alignment or improper height', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '17', 'Out of bracket or guide', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '18', 'Loose', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '19', 'Adjust clearance', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1A', 'Undesired Emergency LRF - No Cause Found', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1B', 'Coupler knuckle with crack in flag hole', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1C', 'Failed compression test', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1D', 'Vertical split rims', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1E', 'Welding other than original construction', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1F', 'Reflective sheeting minimum reflectivity', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1G', 'Bolster with cracked or broken rim', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1H', 'Mate valve portion per Rule 4.B.11', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1J', 'Coupler with broken pin protector', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '1K', 'Over age air brake valve per Rule 4.A.3.a', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '20', 'Air Brakes cut out', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '21', 'Overdate / Overage', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '22', 'Date illegible', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '23', 'Government regulatory requirement', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '24', 'Attention required', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '25', 'Owner''s request', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '26', 'Decayed or deteriorated', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '27', 'Initial application', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '28', 'Adjustment required', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '30', 'Contamination per Rule 97', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '31', 'Fire or heat damage per Rule 95', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '32', 'Submerged per Rule 95', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '33', 'Derailment damage per Rule 95', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '34', 'Unfair usage per Rule 95', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '35', 'Submerged per Rule 99', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '36', 'AEI tag unreadable', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '37', 'AEI tag data not in agreement with Umler', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '38', 'Door open', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '39', 'AEI tag inoperative', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '40', 'Twisted', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '41', 'Cracked', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '42', 'Improperly located or applied', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '43', 'Reflective sheeting damaged or obscured', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '44', 'Reflective sheeting complete renewal', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '45', 'Wrong size component', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '46', 'UCI indicates defective', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '47', 'Angle / end cock handle or top cap stops missing', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '48', 'Thin rim with dynamic impact', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '49', 'Reflective sheeting lacking FRA 224 stamp', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '50', 'Roller bearing overheated', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '51', 'Roller bearing temp. perf per MSRP, S-6001 - Sec.F', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '52', 'Roller bearing temp. perf composite per MSRP, S-6001 - Sec. F', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '54', 'Axle broken or visually cracked', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '55', 'Axle damaged between wheel seats  1/8 in. or deeper', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '56', 'Axle with evidence of welding', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '59', 'Axle bent', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '60', 'Thin flange', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '61', 'High impact wheel - level O', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '62', 'Vertical flange', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '63', 'Wheel tread hollow', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '64', 'High flange', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '65', 'High impact wheel - level C', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '66', 'Cracked or broken flange', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '67', 'Wheels out-of-round', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '68', 'Cracked or broken rim', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '69', 'Thermal crack extending into the plate', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '71', 'Shattered rim', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '73', 'Thin rim', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '74', 'Thermal crack', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '75', 'Shelled tread', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '76', 'Built-up tread', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '77', 'Grooved tread', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '78', 'Slid flat', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '79', 'Coupler with crack behind horn', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '80', 'Scrape, dent, or gouge', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '81', 'Wheel out of gage', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '82', 'Coupler with cracked front face', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '83', 'Cracked or broken wheel plate', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '84', 'Hole in plate', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '85', 'Loose wheel', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '86', 'Coupler with cracked key slot', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '87', 'Coupler with cracked pin protector', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '88', 'Coupler with crack behind pulling lug', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '89', 'Subsurface defect', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '91', 'Acoustic bearing detector Level 1, non-verified', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '92', 'Loose or missing cap screw', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '93', 'Seal loose or cocked out of position', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '94', 'Weld arc damage', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '95', 'Roller bearing fused due to overheating', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '96', 'Acoustic bearing detector Level 1', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '97', 'Loose backing ring', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', '99', 'Damaged Seals', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'TQ', 'Tank Qualification', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO repair.why_made_codes (tenant_id, code, description, active, created_by)
VALUES ('00000000-0000-4000-8000-000000000001', 'ZZ', 'Testing', true, 'seed:why-made')
ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description;
COMMIT;
-- why-made: 103

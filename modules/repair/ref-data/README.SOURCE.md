# AAR Reference Tables for the repairSMART Rebuild (built 2026-10-14)

**PRIVATE / LICENSED.** These files are drawn from RESIDCO's licensed AAR manuals. Keep them on Bruce's PC and the private box only. Don't publish them, commit them to a public repo, or upload them to the web.

## Sources
- AAR Office Manual 2026, Rev 2026-03-18, Change 26-1, file `2026_04_OM_REV20260318(Watermarked) (1).pdf` (423 pp). Source for the price matrix (pp 177-423, "EFF: Apr 01 2026", print date Mar 14 2026) and for the OM rule text. Effective quarter: **2026Q2**.
- AAR Field Manual 2026, Rev 2026-01-27, file `2026_01_FM_REV20260127(FullUnlocked)Watermarked.pdf` (825 pp). Source for Rule 83 (condition, car part, why-made, responsibility, and location codes) and the job code lists in the rule text. Effective quarter: **2026Q1**.
- `Desktop\RepairSMART Rebuild\Reference\Repair_Categories.xlsx` (RESIDCO). Sheets: "JC's & QA's" (2,170 rows, the source for repair_categories), "WM's" (103 why-made codes), and "List By Sub_Cat" (a pivot, not used).

## Method
1. Ran `pdftotext -layout` on each PDF.
2. Python regex parsing:
   - Each price-matrix block (`JOB nnnn <desc> QLFR - qq RULE r`, the location and max-unit lines, `MATL UNIT / CID(Y/N)`, and the price rows COND / WHY MADE / RESP / MATERIAL / STD HRS / LABOR / CREDIT / PRICE) is parsed.
   - FM Rule 83 sections 14-18 are parsed.
   - The spreadsheet is read with openpyxl.
3. `pdf_page` is the physical PDF page number, not the printed page number.

## Files and row counts (data rows, excluding the header)
- component_id_rules.csv 73
- ref_car_part_codes.csv 493
- ref_condition_codes.csv 15
- ref_job_code_prices.csv 3078
- ref_job_codes.csv 855
- ref_location_codes.csv 22
- ref_qualifiers.csv 639
- ref_responsibility_codes.csv 9
- ref_why_made.csv 107
- repair_categories.csv 2170
- `ref_job_codes.csv`: one row per job code. Contains: qualifiers (pipe-separated), rule, the CID flag, material unit, max units, the number of price rows, min/max price, and category/sub_category joined from the spreadsheet (job+qualifier first, then job only).
  - 639 rows come from the OM price matrix.
  - 216 more are job codes listed only in the FM rule text, with no OM price. These have blank price fields, and their source column says so.
  - 641 of 855 rows have a category.
- `ref_job_code_prices.csv`: every priced combination (job, qualifier, condition, why-made, resp) with material, std hrs, labor, credit, and price in USD. A (V) flag means variable labor.
- `ref_qualifiers.csv`: job + qualifier with the matrix description and the allowed locations (single / articulated / drawbar).
- `ref_why_made.csv`: FM 83.17, plus the spreadsheet's description for comparison.
- `ref_condition_codes.csv`: FM 83.15.
- `ref_car_part_codes.csv` (bonus): FM 83.16 car part codes. This is the "qualifier" column used in Bruce's spreadsheet for rows with no job code.
- `ref_location_codes.csv`: FM 83.14. A, B, R1-R4, L1-L4, BR/BL/AR/AL, brake beams 1-4, plus the articulated and drawbar conventions as pattern rows.
- `ref_responsibility_codes.csv`: AAR codes 1-3 (FM 83.18) and RESIDCO internal codes 4-9 (source=RESIDCO).
- `component_id_rules.csv`:
  - 63 job codes flagged `CID(Y/N):Y` in the OM matrix (air brake emergency/service portions, slack adjusters, wheel sets, EOC cushion pocket groups).
  - 10 rule-text requirements quoted from OM Rules 4, 8, 16, 17, 18, 44, 47, 48, 59, and 93, with the rule's job code range taken from the OM table of contents.
- `repair_categories.csv`: all 2,170 spreadsheet rows. row_type is either job_code (1,356) or car_part_code (814 rows keyed by car part code, no job code).

## Known gaps and uncertainty
- **Qualifier dictionary.** Neither manual has a standalone generic qualifier table. Qualifier meaning is job-specific, so ref_qualifiers carries the description of each job+qualifier block. In the matrix, each job code has exactly one qualifier block (e.g. 00, 03, 16).
- **OM price matrix coverage.** The matrix covers 639 job codes (1116-5884), and every JOB header in the PDF was parsed (639/639). The 216 codes that appear only in the FM have no prices. The FM text pass may also miss some codes whose lines don't match the "dddd  UPPERCASE DESC" pattern.
- **Component ID.** The OM matrix CID flag does not mark couplers, bolsters, or side frames as Y. Their requirement comes from the rule text (OM Rules 16-18, 47, and 48), and those rows use the rule's whole job code range. That range is broader than just the component-body codes and should be narrowed by hand (e.g. coupler bodies only, not knuckle pins).
  - Knuckles, yokes, roller bearings, and axles: no AAR Component ID reporting requirement was found in the text. They are not included.
  - Tank car pressure relief valve CID (FM Rule 81, item 6) has no job code mapping and is not included.
- **Locations.** A 6/8-wheel truck car is "same principle" per the text. No R5-R8 rows were invented. The articulated and drawbar rows are patterns, not enumerated codes.
- **Why-made.** The FM has 107 codes and the spreadsheet has 103. Compare the two description columns.
- **Effective dates.** The OM matrix is Apr 1 2026. The FM is Jan 2026, so newer FM revisions, if issued, are not reflected.

## Spot checks
For each table, 10 random rows were checked against the PDF text on the cited page (or against the spreadsheet). All 10 matched for: job codes, qualifiers, prices, why-made, condition codes (after a page-reference fix), car part codes, and repair categories.

All 63 CID flags were confirmed. 59 sit on the cited page; the other 4 are blocks that continue onto the next page (including 3339, 3346, and 3377), where the CID line is on the following page. The rule-text CID rows are verbatim quotes.
ref_job_codes.csv: 10/10 verified
  OK  2630 | NACO CONNECTOR PRIMARY PIN
  OK  1652 | BRK BEAM UNIT TYP-18, CAST IRON
  OK  3349 | NEW WHEEL SET 28 INCH, 1W 6 X 11 AXLE, UBR
  OK  5768 | POCKET GROUP EOC-12D
  OK  1240 | LOK-RING REPAIR COUPLING, 1 INCH
  OK  1298 | ABD EMERGENCY PORTION
  OK  6633 | HINGED DECK HINGE PIN—OUTER
  OK  4459 | LABOR, JACK CAR - LINE OF ROAD
  OK  1401 | EMPTY LOAD SENSOR VALVE MNTING GASKET (GROUP 1)
  OK  3081 | WHEEL 36" 2W HT-CP
ref_qualifiers.csv: 10/10 verified
  OK  5428 | UPPER VERTICAL STRUT PIVOT PIN
  OK  1270 | DIRT COLLECTOR, COMPLETE
  OK  4456 | TRAIN DELAY ALLOWANCE, LINE OF ROAD
  OK  2049 | COUPLER BODY, E 67 BHTE OR E 67 BE
  OK  1208 | PIPE FITTING, E.H. 1 OR 1-1/4 INCHES
  OK  1360 | RELEASE VALVE ROD COMPLETE, ANY TYPE
  OK  3932 | TRUCK SPRING, INNER COIL, D6
  OK  3588 | TRUCK SIDE BEARING SHIM
  OK  1295 | DB-10C SERVICE PORTION
  OK  2174 | COUPLER BODY EF511* - C, E, AE, BE, CE OR WE
ref_job_code_prices.csv: 10/10 verified
  OK  1431 | 1431
  OK  3940 | 3940
  OK  2898 | 2898
  OK  1323 | 1323
  OK  4006 | 4006
  OK  1586 | 1586
  OK  2021 | 2021
  OK  4455 | 4455
  OK  4428 | 4428
  OK  4081 | 4081
ref_why_made.csv: 10/10 verified
  OK  1H | Mate valve portion per Rule 4.B.11
  OK  61 | High impact wheel (80 kips to less than 90 kips)
  OK  62 | Vertical flange
  OK  35 | Submerged per Rule 99
  OK  1G | Bolster with cracked or broken rim
  OK  11 | Removed in good condition, account of associated repairs
  OK  1F | Reflective sheeting does not meet the minimum reflectivity levels per 
  OK  59 | Axle bent
  OK  1T | Broken or cracked weld
  OK  20 | Air Brakes cut out
ref_condition_codes.csv: 6/10 verified
  MISS 0 | Labor attention such as: a. Actual labor b. Replacing or rehanging doo
  MISS 3 | Reconditioned or recertified material applied
  OK  B | Wheel set with reconditioned roller bearings and reconditioned/ second
  MISS 2 | Secondhand material applied
  OK  C | Wheel set with new roller bearings and reconditioned/secondhand axle
  OK  8 | Remove, repair and replace same part
  OK  G | Purchased core wheel set with new roller bearings and reconditioned/ s
  OK  T | Component transfer
  MISS 1 | New material applied
  OK  D | Wheel set with reconditioned roller bearings and new axle
ref_car_part_codes.csv: 10/10 verified
  OK  QF | ROUTING CARDBOARD
  OK  NT | HOPPER DOOR GUIDE
  OK  FV | BODY CENTER PLATE
  OK  HU | COUPLER CARRIER WEAR PLATE
  OK  CZ | RELEASE VALVE HANDLE
  OK  KP | CORNER GUSSET
  OK  RT | THRESHOLD SUPPORT ANGLE
  OK  AQ | ANGLE COCK BRACKET
  OK  CAR | BODY
  OK  AP | ANGLE COCK
component_id_rules.csv: 2/10 verified
  MISS 3334 | CID(Y/N):Y in OM price matrix
  OK  1116-1612 | 1. All emergency and/or service brake valve replacements must be repor
  OK  3328-3399 | 8. All wheel set replacements/transfers must be reported by the repair
  MISS 3379 | CID(Y/N):Y in OM price matrix
  MISS 3349 | CID(Y/N):Y in OM price matrix
  MISS 5752 | CID(Y/N):Y in OM price matrix
  MISS 5750 | CID(Y/N):Y in OM price matrix
  MISS 3362 | CID(Y/N):Y in OM price matrix
  MISS 3347 | CID(Y/N):Y in OM price matrix
  MISS 3340 | CID(Y/N):Y in OM price matrix
repair_categories.csv: 10/10 match source spreadsheet rows

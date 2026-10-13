# Railinc CRB / 500-Byte Repair Billing File — Reference for repairSMART Replacement

Prepared 2026-10-13 from **public** Railinc documents. Primary source: *Car Repair Billing Procedures Manual* (Railinc, public PDF) — Appendix G has the full mandatory record layouts. Labels used below:
- **[SPEC]** = confirmed from the public CRB Procedures Manual
- **[SAMPLE]** = observed in the OFOX 2609 sample file
- **[INFERRED]** = our interpretation, not stated in the spec

## 1. Overview
- **CRB** = Railinc Car Repair Billing. **CRBDX** = the monthly Data Exchange of repair bills for foreign freight equipment. [SPEC/FAQ]
- Governing rules: **AAR Office Manual Rule 112** (CRB process / invoicing), **Rule 113** (CRBDX participation mandatory, 500-byte format), **Rule 114** (FindUs.Rail use mandatory for billing parties). Field Manual **Rule 83** governs repair reporting codes (responsibility, facility type, etc.). Full rule text is sold by AAR Publications (not public). [SPEC/Webinar]
- Two ways in: (1) a **500-byte fixed-width file via FTP mailbox** ("CRIP" = Car Repair Inbound file), or (2) Railinc's web **Billing Repair Card (BRC)** module, which Railinc converts to 500-byte. Billed parties receive a **CROP** (Car Repair Outbound) file, 500-byte or PDF. [SPEC/Webinar/BRC UG]
- Railinc **only validates format**, not whether the bill is right; payment is at the billed party's discretion. [BRC UG]
- Participants: railroads, car owners/lessors, contract shops, running repair agents, third-party agents. [FAQ]

## 2. Monthly cycle [SPEC unless noted]
| Step | When |
|---|---|
| Repairs performed, BRCs/records built through the month | Account month (YYMM) |
| BRC users: all BRCs must be Priced and invoiced/submitted | Before last business day of month |
| **Inbound cut-off** (CRIP files to Railinc) | **2nd business day** of following month |
| **Data Exchange run / Outbound** (CROP files + reports) | **3rd business day** |
| Receivers must download from FTP mailbox | Within **14 days** of the DX run |
| Late files | Held for next cycle |
- Exact dates: annual Data Exchange schedule published by Railinc each December (Railinc business-day calendar). Get it from csc@railinc.com / Railinc CRB product page.
- **One file per submitter per month**; a file can hold many invoices to many billed parties. Resubmission in the same period must use the **identical (case-sensitive) file name**.
- Reports: Inbound Data Exchange Report (to submitter on processing), Billing Party Log (after DX), Outbound Data Exchange Log (to receivers). Excel/PDF via secure links; Railinc SSO account needed.
- Once a BRC is submitted to DX and invoiced, no changes/deletes; corrections go through **resubmitted invoice** fields or **rebuttal** detail sources (RE, DR, JR).

## 3. File transfer [SPEC]
- Railinc sets up an **FTP mailbox** (no charge); connectivity details given at setup. Public docs say "FTP"; whether SFTP/FTPS is required is **not stated publicly** → confirm with Railinc.
- File name **CRIPYYMM.txt** or **.dat**, then **zipped** with the same name; one text file per zip. Multi-party submitters prefix the billing mark: `CSXT_CRIPYYMM.TXT`.

## 4. Record layouts (500 bytes, 1-based columns) [SPEC – CRB Procedures Manual App. G.1]
The **first character is the record format** (1, 6, 8, 9). Characters 2–5 are the **Billing/Invoicing Party mark** (4 chars, space-padded). So `1APA ` = Format 1, billing party "APA". There is no separate "1AP*" record family — the "4th character" is just part of the billing mark. Amounts: numeric, **2 implied decimals** (manual example: $1,500.00 → `0000150000`).

### Format 1 — Repair/Misc Charge detail
| Col | Len | Field | Fmt | R/O/C |
|---|---|---|---|---|
|1|1|Record Format "1"|A/N|R|
|2|4|Billing/Invoicing Party|A/N|R|
|6|4|Billed Party|A/N|R|
|10|4|Account Date YYMM|N|R|
|14|16|Invoice Number|A/N|R|
|30|1|Price Master Currency (U/C)|A/N|R|
|31|2|Detail Source (BR, CB, DC, DE, DM, DR, GB, GT, HT, IV, JD, JI, JR, MA, OT, PT, QT, RE, SH)|A/N|R|
|33|15|Document Reference No. (CBA no. for CB)|A/N|C|
|48|4|Car Initial|A|R|
|52|6|Car Number|N|R|
|58|1|Kind of Car Symbol|A|C|
|59|1|Load/Empty (L/E/U)|A/N|C|
|60|6|Repair Date YYMMDD|N|R|
|66|6|SPLC|N|R|
|72|4|Repairing Party|A/N|R|
|76|16|Repairing Party Invoice No.|A/N|R|
|92|15|Repairing Party Doc Ref No. (RE)|A/N|C|
|107|2|Repair Facility Type (BS CS ET LR RT YD)|A/N|R|
|109|2|Location on Car|A/N|C|
|111|1|Reserved (Location → 3 chars)|A/N|O|
|112|1|Reserved (Quantity → 5 digits)|N|O|
|113|4|Quantity|N|R|
|117|1|Condition Code|A/N|R|
|118|2|Reserved (Applied JC → 6 digits)|N|O|
|120|4|Applied Job Code|N|R|
|124|3|Applied Qualifier / Car Part Code (shared)|A/N|C|
|127|2|Why Made Code|A/N|R|
|129|2|Reserved (Removed JC → 6)|N|O|
|131|4|Removed Job Code|N|R|
|135|3|Removed Qualifier / Car Part Code|A/N|C|
|138|1|Responsibility Code|N|R|
|139|4|Defect Card/JIC Party|A/N|C|
|143|6|Defect Card/JIC Date YYMMDD|N|C|
|149|7|Labor Charge (2 dec)|N|R|
|156|8|Material Charge (2 dec)|N|R|
|164|1|Material Sign D/C|A|R|
|165|1|Machine Priceable Y/N/H|A|R|
|166|1|Wrong Repair Indicator Y/N/blank|A|C|
|167|28 or 50|Wheel narrative (28) / Non-wheel description (50)|A/N|R|
|195–216| |Wheel data: applied/removed wheel date MMYY, mfr code, class, side & finger readings (wheel job codes only)|—|C|
|217|5|Labor Rate|N|O|
|222|9|Expanded SPLC|N|O|
|231|13 ×4|CIF Repairing / Billing / Billed / Defect-JIC Party|A/N|O|
|283|6|Filler|N|O|
|289|5|Line Number|N|R|
|294|6|Railinc Inbound Date Stamp (Railinc fills)|N|—|
|300|6|Railinc Outbound Date Stamp (Railinc fills)|N|—|
|306|1|Resubmitted Invoice Indicator ("R")|A/N|C|
|307|16|Original Invoice Number|A/N|C|
|323|4|Original Account Date YYMM|N|C|
|327|14|AAR Component ID (CID)|A/N|C|
|341|12|**DDCT Incident ID** (XXXX99999999)|A/N|O|
|353|48|Reserved|A/N|O|
|401|100|Free User Area|A/N|O|

### Format 6 — Contact (one **BP** per invoice mandatory; RT, IQ, EX, IP optional)
1 "6" · 2 Billing Party(4) · 6 Billed Party(4) · 10 Acct YYMM(4) · 14 Invoice(16) · 30 Currency(1) · 31 Contact Type(2) · 33 Company Name(50) · 83 Name(35) · 118 Title(35) · 153 Phone(25) · 178 Fax(25) · 203 E-mail(60) · 263–442 Address 1–4 (45 each; 1 required) · 443 City(35) · 478 State(2) · 480 Country US/CA/MX(2) · 482 Zip(10) · 492 Reserved(9). Note: owners may reject invoices lacking Format 6 data even if Railinc accepts.

### Format 8 — Invoice subtotal (per detail source) and total (Detail Source "ZZ")
1 "8" · 2 Billing(4) · 6 Billed(4) · 10 Acct(4) · 14 Invoice(16) · 30 Currency(1) · 31 Detail Source or ZZ(2) · 33 Record Count of Format 1s(7) · 40 Labor(10) · 50 Material(16) · 66 Sign(1) · 67 Invoice Date YYMMDD(6) · 73 Taxpayer ID(15; required on ZZ) · 88 Payment Terms(2) · 90 Payment Due Date(6) · 96/102 Railinc in/out stamps · 108 Reserved(293).

### Format 9 — File control (input)
1 "9" · 2 Billing(4) · 6 "ZZZZ" · 10 Acct(4) · 14 16×"Z" · 30 "Z" · 31 "ZZ" · 33 Record Count(7) · 40 Labor sum(10) · 50 Material sum(16) · 66 Sign(1) · 67 Reserved(434). Must be the last record.

### Mandatory order (else file rejected) [SPEC G.3]
Per invoice: Format 1s grouped by detail source → one **8 <DS>** after each group → **6** records (BP mandatory) → **8 ZZ** invoice total. Then **9 ZZ** file total last.

## 5. Validation / rejection rules [SPEC]
- Critical errors → Railinc rejects **the whole file or the affected invoice**. Invalid/unknown Billing or Billed Party marks are critical. Only files "accepted" or "partially accepted" flow out.
- Detail totals are reconciled to Format 8 and 9; **no out-of-balance data is exchanged**.
- Edit charts by position: Manual Appendix C/D (Format 1, 6, 8, 9) and separate **CRBDX Error Codes** PDF (e.g. qualifier rules: if Machine Priceable = Y/H, Applied/Removed Qualifier must be blank/alpha/numeric and ≤ Price Master max; Car Part Code required when PM qualifier = VZ, per Rule 83). Wheel fields 195–216 edited only for wheel job codes.
- Wrong Repair = "Y" prices the couplet at zero.
- Location codes restricted to listed sets (single-unit: A,B,C,R,L,1–8,AR,AL,BR,BL,R1–R8,L1–L8, blanks; separate sets for articulated/drawbar).
- Responsibility codes in the public CRB manual: **1 Owner, 2 Handling Line, 3 Defect Card/JIC**.
- Pricing of machine-priceable lines uses the Railinc **Price Master** file (Rule 107-adjacent job code prices are in AAR Rules; price master via FTP to subscribers).

## 6. Sample file mapping — `Sample_Shop_500byte_OFOX2609.txt`
File facts [SAMPLE]: 123 lines, each 500 chars + **CRLF**, pure ASCII, all Format 1. **No Format 6, 8, or 9 records** → this is a detail extract, not a complete CRIP submission.

| Col | Field (spec) | Sample value | Status |
|---|---|---|---|
|1|Record Format|`1` all|confirmed-from-spec|
|2–5|Billing Party|`APA ` all|confirmed-from-spec (shop mark "APA"; verify in FindUs.Rail)|
|6–9|Billed Party|`OFOX`|confirmed-from-spec|
|10–13|Account Date|`2609` (Sep 2026)|confirmed-from-spec|
|14–29|Invoice Number|**blank**|confirmed position; blank would be a critical error in a real CRIP|
|30|Currency|`U`|confirmed|
|31–32|Detail Source|`BR`|confirmed|
|33–47|Doc Ref|blank|confirmed|
|48–57|Car|`OFOX 528313` (1 car)|confirmed|
|58|Kind of Car|`G`|confirmed (meaning of G per AAR car type codes — not verified)|
|59|Load/Empty|`E`|confirmed|
|60–65|Repair Date|`260901`|confirmed|
|66–71|SPLC|`791181`|confirmed|
|72–75|Repairing Party|`APA `|confirmed|
|76–91, 92–106|RP invoice / doc ref|blank|confirmed (RP invoice is R in spec → would fail)|
|107–108|Facility Type|`CS` contract shop|confirmed|
|109–110|Location|R, L, blank, B… (14 values)|confirmed|
|113–116|Quantity|0001…0256|confirmed|
|117|Condition Code|0, 1, 7|confirmed position; code meanings in AAR rules (not public)|
|120–123 / 131–134|Applied / Removed Job Code|23 codes, e.g. 4800, 4204, 8040; applied = removed on every line|confirmed|
|124–126 / 135–137|Applied / Removed Qualifier|QY, NA, NB, blank…|confirmed|
|127–128|Why Made|09, 02, 22, 18…|confirmed|
|138|Responsibility|**6** (98 lines), **7** (25)|confirmed position; values 6/7 are **not** in the public CRB list (1–3) → owner/lessor-internal (resp 6 = lessee per this project) [INFERRED]|
|149–155|Labor|sum 3,230,125 → **$32,301.25**|confirmed (2 implied dec)|
|156–163|Material|sum 443,079 → **$4,430.79**|confirmed|
|164|Sign|`D`|confirmed|
|165|Machine Priceable|`N` all|confirmed|
|167–216|Description (50, non-wheel)|e.g. "HIGH PRESSURE WATER BLAST"|confirmed|
|217–221|Labor Rate|`11500` = $115.00/hr|confirmed field; decimals [INFERRED]|
|289–293|Line Number|00001–00123 sequential|confirmed|
|294–500|Railinc stamps, resubmit, CID, DDCT, free area|all blank|confirmed|
Total sample: **$36,732.04** (labor + material) [computed].

## 7. Implications for parser / regeneration
1. **Store the original file bytes unchanged** (object storage, WORM/retention), plus SHA-256; parse into tables that keep each raw 500-char line and its source line number.
2. Parse by **spec column table as config** (versioned), not hard-coded slices — reserved fields (111, 112, 118, 129) are flagged for future expansion.
3. Accept CRLF and LF; reject lines ≠ 500 chars; ASCII only.
4. Dispatch on col 1 (1/6/8/9). Tolerate detail-only extracts (like the sample) but flag "not a complete CRIP".
5. Amounts: integers in cents; apply Material Sign; never floats.
6. **Round-trip test**: regenerate each line from parsed fields + preserved untouched spans and assert byte-equality with the original. Preserve Free User Area (401–500) and unknown/reserved spans verbatim.
7. Regenerating a submittable CRIP needs: invoice number, repairing-party invoice no., Format 8 per detail source + 8 ZZ (with Taxpayer ID), Format 6 BP, Format 9; naming `CRIPYYMM` zipped; one file/month.
8. Validate locally against the published edits before submission; model Railinc's Inbound report results as events in the audit trail.
9. Responsibility codes, statuses, and code tables should be tenant-configurable (6/7 are internal).
10. Capture DDCT Incident ID (341) and CID (327) when present to link to Rule 107/DDCT records.

## 8. Gaps — not public / to confirm
- Full AAR Office & Field Manual (Rules 83, 107, 108, 112, 113, 114), job code / why-made / condition code / qualifier tables, and Rule 107 depreciated-value tables — purchased from AAR Publications.
- Price Master file content (subscription).
- Current-year Data Exchange calendar (exact dates) — Railinc publishes each December.
- FTP vs SFTP/FTPS specifics, hosts, credentials — given at onboarding.
- DDCT (Damaged & Defective Car Tracking) record specs and Rule 107 handling-line process details — only the DDCT Incident ID field (col 341) is confirmed here.
- Meaning of responsibility codes 6/7 and Kind of Car `G` for this file — confirm with RESIDCO / shop.
- Whether "APA" is the shop's mark (FindUs.Rail lookup).

## 9. Sources
- CRB Procedures Manual: https://public.railinc.com/sites/default/files/documents/CRB_ProceduresManual.pdf (§1.2–1.5, App. A, B, C/D, G.1–G.3)
- CRB Data Exchange FAQs: https://public.railinc.com/sites/default/files/documents/CRBDX_FAQs.pdf
- Billing Repair Card User Guide: https://public.railinc.com/sites/default/files/documents/CRB_UG.pdf
- CRB Webinar slides: https://public.railinc.com/sites/default/files/documents/CRB_Webinar_Slides.pdf
- CRBDX Error Codes: https://public.railinc.com/sites/default/files/documents/CRBDX_ErrorCodes.pdf
- SPLC (NMFTA): http://www.nmfta.org/pages/splc.aspx
- AAR Publications (rules, purchase): https://www.aarpublications.com

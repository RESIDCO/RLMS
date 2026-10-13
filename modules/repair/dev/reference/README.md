# Repair module reference files (kept in-repo)

- `Sample_Shop_500byte_OFOX2609.txt` — round-trip parser test input (keep).
- `Railinc_Data_File_Reference.md` — CRB Appendix G field layout notes (keep).

Seed-only spreadsheets (`Shop_Payee_List.xlsx`, `Repair_Categories.xlsx`) live in the
Project store at `internal/briefs/reference/` — not in the git tree. Seeds are already
materialized as SQL under `migrations/20261014_repair_seed_*.sql`.

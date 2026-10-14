# AAR Reference Tables (licensed) — `modules/repair/ref-data/`

**Private / licensed.** Never serve these CSVs from an unauthenticated public route.

Source (Bruce PC): `C:\Users\BruceHarbridge\OneDrive - RESIDCO\Desktop\RepairSMART Rebuild\AAR Reference Tables\`

Import:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
npm run repair:import-ref-data
```

Expected full counts: job codes ≈855 · qualifiers ≈639 · why-made ≈107 · categories ≈2,170.

See `README.SOURCE.md` for the pack’s own documentation.


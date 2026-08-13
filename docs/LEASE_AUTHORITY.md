# Lease status authority

## Decision (2026-08-13)

**Source of truth for lease status, expiration, lessee, and OL code:** `railcars` fields maintained by monthly VCF import:

- `rider_external_id` (OL code)
- `lessee_name`
- `assignment_label`
- `lease_start_date` / `lease_end_date` / `lease_expiry`

**`riders.expiration_date` is not authoritative.** It was seeded early and went stale (hundreds of OLs showing expired dates while cars remain actively assigned). Dashboard KPIs must not join through it for “is this lease current?”

## riders table going forward

Keep `riders` for MLA structure, contacts, Move Cars destination IDs, and Lease Management editing — but treat `expiration_date` as a **derived cache**:

1. Refreshed after each VCF commit (`syncRiderExpirationsFromCars`)
2. Also runnable via `POST /api/riders/sync-expirations` or `python script/sync_rider_expirations.py`
3. Match key: `riders.rider_name` / `schedule_number` ↔ `railcars.rider_external_id`
4. Value: max known `lease_end_date` among active cars on that OL (null when VCF end is indefinite)

Do not reintroduce Dashboard / expiration-timeline / Active OL counts from the riders table without re-validating against car-level fields.

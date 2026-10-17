# Put on rent from a program

Return and New Assignment programs can drive a car onto rent without leaving the program page. This is **preview → sign-off → apply**. The apply path is in the API; do not run it against live cars until a preview is signed off.

## What it writes

For each selected **active, not Sold** program car, one `change_group`:

1. If the car is not already on the chosen rider, update `railcar_assignments` the same way `/api/move` does (`assignmentRentStartOnMove`, assignment history, `recordChange`).
2. Set `railcar_assignments.rent_start_date` (and set-by / set-at) via existing `setRentStartDate` / move rent-start logic.
3. Append trail milestone **On rent** with the rent-start date (`program_car_milestones` + denormalized `program_cars.milestone` / `milestone_at`).

Program **done** is still **arrived at the committed destination** (`outcome_reached_at`). On rent is a later trail step, not a substitute for arrival.

## Preview buckets

- `to_write` — will move (if needed) and set rent start
- `already_on_rider` — already on that OL; only rent start (skip if a date exists and overwrite is off)
- `rejected_inactive` / `rejected_sold` — never written
- `not_writable` — exited program link
- `kpi_delta` — same annotator as bulk rent-start

## Not in this action

- Does not deactivate or Sold-flag cars
- Does not clear commitments
- Does not close the program
- Does not write RepairSMART

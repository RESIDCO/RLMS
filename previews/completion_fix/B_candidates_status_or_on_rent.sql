-- Preview only. Do not apply. Active, not Program done, status looks complete/delivered/arrived or KPI on_rent.
-- Rule to propose when Bruce approves a program:
--   On rent counts only if current lease/lessee differs from the program source OL (new lessee).
--   Never On rent for Scrap-type programs.
SELECT
  pc.id AS program_car_id,
  p.id AS program_id,
  p.name AS program_name,
  coalesce(p.type, tm.display_type) AS program_type,
  rc.reporting_marks,
  rc.car_number,
  rc.lessee_name,
  rc.rider_external_id,
  k.on_rent,
  pc.status,
  pc.outcome_reached_at,
  pc.custom_fields->>'__complete' AS complete_flag
FROM public.program_cars pc
JOIN public.programs p ON p.id = pc.program_id
JOIN public.railcars rc ON rc.id = pc.railcar_id
LEFT JOIN public.v_program_type_map tm ON tm.program_id = p.id
LEFT JOIN public.v_rlms_kpi_car_rows k ON k.railcar_id = rc.id
JOIN public.v_program_lifecycle lc ON lc.program_id = p.id
WHERE pc.exited_date IS NULL
  AND lc.lifecycle = 'active'
  AND rc.active IS TRUE
  AND NOT public.rlms_program_car_is_program_done(pc.id)
  AND (
    k.on_rent IS TRUE
    OR pc.status ~* '(complete|delivered|arrived)'
  )
ORDER BY p.id, rc.reporting_marks, rc.car_number;

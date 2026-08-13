-- Fix: stop overwriting VCF MANAGED_CATEGORY with entity-derived ownership labels.
-- Ownership remains on railcars.entity (Main / Rail Partners Select / Coal).
-- managed_category holds §4.2 canonical values (Idle, Net Lease, ALF Marks, …).
-- Also add lease_end_residual_per_car if missing (§3.4).

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS lease_end_residual_per_car numeric;

COMMENT ON COLUMN public.railcars.lease_end_residual_per_car IS
  'Lease-End RV Per Asset from latest rider_financial_summary refresh (§3.4).';

DROP TRIGGER IF EXISTS railcars_derive_managed_category_trg ON public.railcars;
DROP FUNCTION IF EXISTS public.railcars_derive_managed_category();

COMMENT ON COLUMN public.railcars.managed_category IS
  'VCF MANAGED_CATEGORY (§4.2): Idle | Net Lease | ALF Marks | Non-RAS Managed | Progress, Special Handling. Not derived from entity.';

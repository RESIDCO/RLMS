-- §3: lease-end residual per car on railcars (Asset Report refresh target)
ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS lease_end_residual_per_car numeric;

COMMENT ON COLUMN public.railcars.lease_end_residual_per_car IS
  'Lease-End RV Per Asset from latest rider_financial_summary refresh (§3.4).';

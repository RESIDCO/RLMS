-- When a master lease is marked sold, tag currently assigned cars Sold.
-- Clearing sold_to does not revert cars (a car may have been sold independently).

CREATE OR REPLACE FUNCTION public.master_lease_cascade_sold_to_cars()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sold_to IS DISTINCT FROM OLD.sold_to
     AND COALESCE(NEW.sold_to, '') <> '' THEN
    UPDATE public.railcars r
    SET
      fleet_status = 'Sold',
      sold_to = NEW.sold_to,
      fleet_status_source = 'auto'
    FROM public.railcar_assignments ra
    JOIN public.riders rd ON rd.id = ra.rider_id
    WHERE rd.master_lease_id = NEW.id
      AND ra.railcar_id = r.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS master_leases_cascade_sold_to_cars ON public.master_leases;
CREATE TRIGGER master_leases_cascade_sold_to_cars
  AFTER UPDATE OF sold_to ON public.master_leases
  FOR EACH ROW
  EXECUTE FUNCTION public.master_lease_cascade_sold_to_cars();

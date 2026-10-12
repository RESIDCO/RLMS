-- Guard railcars.car_number: digits only, stored zero-padded to 6.
-- CHECK is NOT VALID and must not be VALIDATE'd until car 23602 is repaired
-- (Section 6 of the 2026-10-12 remark brief). NOT VALID still rejects UPDATEs
-- of that violating row, so the trigger below allows the existing short value
-- to remain unchanged while blocking any *new* unpadded / non-digit write.

CREATE OR REPLACE FUNCTION public.railcars_normalize_car_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.car_number IS NULL OR btrim(NEW.car_number) = '' THEN
    RAISE EXCEPTION 'car_number is required'
      USING ERRCODE = '23514';
  END IF;
  NEW.car_number := btrim(NEW.car_number);
  IF NEW.car_number ~ '^[0-9]{1,6}$' THEN
    NEW.car_number := lpad(NEW.car_number, 6, '0');
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.car_number IS NOT DISTINCT FROM OLD.car_number THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'car_number must be 1–6 digits (stored zero-padded to 6)'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_railcars_normalize_car_number ON public.railcars;
CREATE TRIGGER trg_railcars_normalize_car_number
  BEFORE INSERT OR UPDATE OF car_number ON public.railcars
  FOR EACH ROW
  EXECUTE FUNCTION public.railcars_normalize_car_number();

-- After Section 6 (car 23602 padded and unique), add and validate:
--   ALTER TABLE public.railcars
--     ADD CONSTRAINT railcars_car_number_six_digits_chk
--     CHECK (car_number ~ '^[0-9]{6}$') NOT VALID;
--   ALTER TABLE public.railcars VALIDATE CONSTRAINT railcars_car_number_six_digits_chk;
-- Do not add the CHECK while 23602 is still 5 digits: NOT VALID still rejects
-- UPDATEs of that row (any column), which would lock the live car.

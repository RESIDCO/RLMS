-- Coal is RESIDCO-owned: stamp managed_category like Main, then backfill existing rows.

CREATE OR REPLACE FUNCTION public.railcars_derive_managed_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entity IS NULL THEN
    NEW.managed_category := COALESCE(NEW.managed_category, NULL);
  ELSIF NEW.entity IN ('Main', 'Coal') THEN
    NEW.managed_category := 'RESIDCO Owned';
  ELSIF NEW.entity = 'Rail Partners Select' THEN
    NEW.managed_category := 'RPS';
  ELSE
    NEW.managed_category := COALESCE(NEW.managed_category, NEW.entity);
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.railcars
SET managed_category = 'RESIDCO Owned'
WHERE entity = 'Coal'
  AND managed_category IS DISTINCT FROM 'RESIDCO Owned';

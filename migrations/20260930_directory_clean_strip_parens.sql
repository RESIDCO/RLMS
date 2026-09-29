-- Ignore parentheticals (sold-to xTrinity, city hints) when cleaning names.

CREATE OR REPLACE FUNCTION public.directory_clean_name(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(t, '')), '\([^)]*\)', ' ', 'g'),
          '^x+',
          ''
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\y(the|inc|llc|llp|corp|ltd|co|company|corporation|incorporated|limited)\y',
      '',
      'g'
    )),
    '\s+', '', 'g'
  );
$$;

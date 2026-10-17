-- Column picker v2: named views, shared defaults, RLS on prefs/programs/program_cars.
-- Structure only. Re-runnable. Does not UPDATE existing preference or program rows.
-- Legacy page keys (including program_cars_<id>) stay; v_user_column_prefs maps them at read time.

ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS list_key text;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS view_name text;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS is_default boolean;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS is_shared boolean;

CREATE UNIQUE INDEX IF NOT EXISTS user_column_prefs_list_view_uidx
  ON public.user_column_prefs (user_id, list_key, view_name)
  WHERE list_key IS NOT NULL AND view_name IS NOT NULL;

CREATE OR REPLACE VIEW public.v_user_column_prefs AS
SELECT
  id,
  user_id,
  page,
  CASE
    WHEN list_key IS NOT NULL AND btrim(list_key) <> '' THEN list_key
    WHEN page ~ '^program_cars_[0-9]+$' THEN 'program_cars'
    ELSE page
  END AS list_key,
  COALESCE(NULLIF(btrim(view_name), ''), 'Default') AS view_name,
  COALESCE(is_default, false) AS is_default,
  COALESCE(is_shared, false) AS is_shared,
  visible_cols,
  updated_at
FROM public.user_column_prefs;

REVOKE ALL ON public.v_user_column_prefs FROM PUBLIC, anon;
GRANT SELECT ON public.v_user_column_prefs TO authenticated, service_role;

ALTER TABLE public.user_column_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_column_prefs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_column_prefs TO authenticated;
GRANT ALL ON public.user_column_prefs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.user_column_prefs_id_seq TO authenticated, service_role;

DROP POLICY IF EXISTS user_column_prefs_select ON public.user_column_prefs;
CREATE POLICY user_column_prefs_select ON public.user_column_prefs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR COALESCE(is_shared, false) IS TRUE);

DROP POLICY IF EXISTS user_column_prefs_insert_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_insert_own ON public.user_column_prefs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

DROP POLICY IF EXISTS user_column_prefs_update_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_update_own ON public.user_column_prefs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE)
  WITH CHECK (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

DROP POLICY IF EXISTS user_column_prefs_delete_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_delete_own ON public.user_column_prefs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.programs FROM PUBLIC, anon;
GRANT SELECT ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;

DROP POLICY IF EXISTS programs_select_authenticated ON public.programs;
CREATE POLICY programs_select_authenticated ON public.programs
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.program_cars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_cars FROM PUBLIC, anon;
GRANT SELECT ON public.program_cars TO authenticated;
GRANT ALL ON public.program_cars TO service_role;

DROP POLICY IF EXISTS program_cars_select_authenticated ON public.program_cars;
CREATE POLICY program_cars_select_authenticated ON public.program_cars
  FOR SELECT TO authenticated
  USING (true);

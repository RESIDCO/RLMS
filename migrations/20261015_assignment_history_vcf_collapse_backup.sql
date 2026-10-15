-- Backup table for the Oct 13 file-has-one assignment_history collapse.
-- Does not change fleet data by itself. Rows are copied here before delete.

CREATE TABLE IF NOT EXISTS public.assignment_history_vcf_collapse_20261015 (
  LIKE public.assignment_history,
  collapse_keep_id integer NOT NULL,
  collapsed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.assignment_history_vcf_collapse_20261015 IS
  'Full assignment_history snapshots of 206 stale extras (file has one of two duplicate-period rows). Restore with script/rollback_vcf_oct13_file_has_one_collapse.sql.';

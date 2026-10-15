-- VCF load log + rollback snapshots. Does not change fleet data until a signed commit.
-- Pattern: save previous row JSON keyed by load_id, then apply. Rollback restores
-- from those rows and deletes only rows inserted by that load. No history deletes
-- of pre-existing periods.

CREATE TABLE IF NOT EXISTS public.vcf_load_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loaded_at timestamptz NOT NULL DEFAULT now(),
  loaded_by text,
  file_name text,
  preview_id uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS vcf_load_log_loaded_at_idx
  ON public.vcf_load_log (loaded_at DESC);

ALTER TABLE public.vcf_load_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.vcf_load_railcar_backup (
  load_id uuid NOT NULL REFERENCES public.vcf_load_log (id) ON DELETE CASCADE,
  railcar_id bigint NOT NULL,
  before jsonb NOT NULL,
  PRIMARY KEY (load_id, railcar_id)
);

CREATE TABLE IF NOT EXISTS public.vcf_load_assignment_backup (
  load_id uuid NOT NULL REFERENCES public.vcf_load_log (id) ON DELETE CASCADE,
  assignment_history_id bigint NOT NULL,
  before jsonb NOT NULL,
  PRIMARY KEY (load_id, assignment_history_id)
);

CREATE TABLE IF NOT EXISTS public.vcf_load_railcar_insert (
  load_id uuid NOT NULL REFERENCES public.vcf_load_log (id) ON DELETE CASCADE,
  railcar_id bigint NOT NULL,
  PRIMARY KEY (load_id, railcar_id)
);

CREATE TABLE IF NOT EXISTS public.vcf_load_assignment_insert (
  load_id uuid NOT NULL REFERENCES public.vcf_load_log (id) ON DELETE CASCADE,
  assignment_history_id bigint NOT NULL,
  PRIMARY KEY (load_id, assignment_history_id)
);

CREATE TABLE IF NOT EXISTS public.vcf_load_cnh_insert (
  load_id uuid NOT NULL REFERENCES public.vcf_load_log (id) ON DELETE CASCADE,
  car_number_history_id bigint NOT NULL,
  PRIMARY KEY (load_id, car_number_history_id)
);

ALTER TABLE public.vcf_load_railcar_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcf_load_assignment_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcf_load_railcar_insert ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcf_load_assignment_insert ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcf_load_cnh_insert ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vcf_open_period_stats()
RETURNS TABLE (active_multi_open bigint, active_no_open bigint)
LANGUAGE sql
STABLE
AS $$
  WITH open_ah AS (
    SELECT railcar_id, count(*) AS n
    FROM public.assignment_history
    WHERE end_date IS NULL
    GROUP BY railcar_id
  )
  SELECT
    count(*) FILTER (WHERE r.active IS TRUE AND coalesce(o.n, 0) > 1)::bigint,
    count(*) FILTER (WHERE r.active IS TRUE AND coalesce(o.n, 0) = 0)::bigint
  FROM public.railcars r
  LEFT JOIN open_ah o ON o.railcar_id = r.id;
$$;

GRANT EXECUTE ON FUNCTION public.vcf_open_period_stats() TO service_role;

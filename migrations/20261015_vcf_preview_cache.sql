-- Staging for Valid Car File preview rows. Survives a process restart between
-- preview and commit. Not a source of truth for the fleet.
CREATE TABLE IF NOT EXISTS public.vcf_preview_cache (
  id uuid PRIMARY KEY,
  loaded_by text NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  rows jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS vcf_preview_cache_created_at_idx
  ON public.vcf_preview_cache (created_at);
CREATE INDEX IF NOT EXISTS vcf_preview_cache_loaded_by_idx
  ON public.vcf_preview_cache (loaded_by);

ALTER TABLE public.vcf_preview_cache ENABLE ROW LEVEL SECURITY;

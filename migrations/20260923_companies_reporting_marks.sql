-- Additive: company-level reporting marks for MARK Contacts import + matching.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS reporting_marks text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_companies_reporting_marks
  ON public.companies USING gin (reporting_marks);

COMMENT ON COLUMN public.companies.reporting_marks IS
  'Reporting marks associated with this company (e.g. from MARK Contacts / FindUs.Rail). Company-level, not per-contact — every contact at a company shares the same mark set in the source data. Used for high-confidence account matching (see the parent scoping doc, Section 4): a match against a mark on an actively-leased RLMS railcar is a strong signal, still surfaced for human confirmation before linking, never auto-linked.';

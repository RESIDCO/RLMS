-- Digit-only phone lookup for directory people (link-existing + list APIs).

ALTER TABLE public.company_contacts
  ADD COLUMN IF NOT EXISTS phone_digits text
  GENERATED ALWAYS AS (
    NULLIF(regexp_replace(coalesce(phone, '') || coalesce(mobile, ''), '[^0-9]', '', 'g'), '')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_company_contacts_phone_digits
  ON public.company_contacts (phone_digits text_pattern_ops);

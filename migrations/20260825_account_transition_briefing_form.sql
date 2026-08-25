-- Briefing form checklist (4-way %) plus digital briefing form tables.
ALTER TABLE public.account_transition_records
  ADD COLUMN IF NOT EXISTS briefing_form_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS briefing_form_completed_date date;

COMMENT ON COLUMN public.account_transition_records.briefing_form_completed IS
  'Has the outgoing AM completed and handed off the Account Handoff Briefing Form. Set explicitly; not gated on the digital form.';
COMMENT ON COLUMN public.account_transition_records.briefing_form_completed_date IS
  'Date the briefing form was completed/handed off. Nullable, settable independent of the boolean.';

CREATE TABLE IF NOT EXISTS public.account_transition_briefing_forms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id bigint NOT NULL REFERENCES public.account_transition_records(id) ON DELETE CASCADE UNIQUE,
  tier_track text,
  effective_date date,
  mailing_address text,
  target_completion date,
  relationship_tenure_history text,
  political_dynamics text,
  background_commercial_history text,
  credit_payment_history text,
  notable_past_negotiations text,
  overall_account_health text,
  growth_potential_pipeline text,
  renewal_risk_retention text,
  whats_worked_hasnt text,
  landmines text,
  outgoing_signature_name text,
  outgoing_signature_date date,
  incoming_signature_name text,
  incoming_signature_date date,
  status text NOT NULL DEFAULT 'draft',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_transition_briefing_forms_status_check
    CHECK (status = ANY (ARRAY['draft'::text, 'completed'::text]))
);

CREATE TABLE IF NOT EXISTS public.account_transition_briefing_contacts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES public.account_transition_briefing_forms(id) ON DELETE CASCADE,
  name text,
  title text,
  role_function text,
  authority text,
  phone text,
  email text,
  comm_pref text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_at_briefing_contacts_form
  ON public.account_transition_briefing_contacts (form_id, sort_order, id);

CREATE TABLE IF NOT EXISTS public.account_transition_briefing_ol_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES public.account_transition_briefing_forms(id) ON DELETE CASCADE,
  ol_number text NOT NULL,
  notes text,
  CONSTRAINT account_transition_briefing_ol_notes_uidx UNIQUE (form_id, ol_number)
);

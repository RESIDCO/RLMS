-- Account Transitions module (handoff tracking). Isolated from accounts.account_manager.

CREATE TABLE IF NOT EXISTS public.account_transition_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  from_account_manager text,
  to_account_manager text,
  communication_method text,
  status text NOT NULL DEFAULT 'open',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_transition_records_account_uidx UNIQUE (account_id),
  CONSTRAINT account_transition_records_status_check
    CHECK (status = ANY (ARRAY['open'::text, 'complete'::text]))
);

COMMENT ON TABLE public.account_transition_records IS
  'AM handoff tracking. Completing a row must never write accounts.account_manager.';
COMMENT ON COLUMN public.account_transition_records.to_account_manager IS
  'Incoming AM. A non-blank value flags this account as an in-module transition.';
COMMENT ON COLUMN public.account_transition_records.from_account_manager IS
  'Outgoing AM snapshot for this handoff. Not a live link to accounts.account_manager.';

CREATE TABLE IF NOT EXISTS public.account_transition_milestones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id bigint NOT NULL REFERENCES public.account_transition_records(id) ON DELETE CASCADE,
  label text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_at_milestones_record
  ON public.account_transition_milestones (record_id, sort_order, id);

CREATE TABLE IF NOT EXISTS public.account_transition_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id bigint NOT NULL REFERENCES public.account_transition_records(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_email text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_at_comments_record
  ON public.account_transition_comments (record_id, created_at DESC);

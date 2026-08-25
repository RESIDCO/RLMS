-- Handoff events for Account Transitions completion scoring.
ALTER TABLE public.account_transition_records
  ADD COLUMN IF NOT EXISTS meeting_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meeting_date date,
  ADD COLUMN IF NOT EXISTS communication_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS communication_completed_date date;

COMMENT ON COLUMN public.account_transition_records.meeting_scheduled IS
  'Has the handoff meeting/call/intro for this account been scheduled yet. Set explicitly by the user, never inferred.';
COMMENT ON COLUMN public.account_transition_records.meeting_date IS
  'Date of the scheduled (or already-held) handoff meeting. Nullable, settable independent of meeting_scheduled.';
COMMENT ON COLUMN public.account_transition_records.communication_completed IS
  'Has the outgoing AM actually delivered the handoff communication to the incoming AM. Set explicitly by the user.';
COMMENT ON COLUMN public.account_transition_records.communication_completed_date IS
  'Date the handoff communication was completed. Nullable, settable independent of the boolean.';

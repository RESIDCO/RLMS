-- Completing an Account Transition writes through to accounts.account_manager.
-- Does not touch riders.account_manager or programs.account_manager.
-- Reopening a record does not revert the account AM.

CREATE OR REPLACE FUNCTION public.account_transition_complete_sync_am()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_incoming text;
  v_current  text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'complete' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'complete' THEN
    RETURN NEW;
  END IF;

  v_incoming := nullif(btrim(NEW.to_account_manager), '');
  IF v_incoming IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.account_manager INTO v_current
  FROM public.accounts a
  WHERE a.id = NEW.account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_current IS NOT DISTINCT FROM v_incoming THEN
    RETURN NEW;
  END IF;

  UPDATE public.accounts
     SET account_manager = v_incoming
   WHERE id = NEW.account_id
     AND account_manager IS DISTINCT FROM v_incoming;

  INSERT INTO public.account_transition_comments (record_id, author_email, body)
  VALUES (
    NEW.id,
    'system',
    format(
      'Account Manager on the account changed from %s to %s on completion',
      coalesce(nullif(btrim(v_current), ''), 'unassigned'),
      v_incoming
    )
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_account_transition_complete_sync_am ON public.account_transition_records;
CREATE TRIGGER trg_account_transition_complete_sync_am
  AFTER INSERT OR UPDATE OF status ON public.account_transition_records
  FOR EACH ROW
  EXECUTE FUNCTION public.account_transition_complete_sync_am();

COMMENT ON TABLE public.account_transition_records IS
  'AM handoff tracking. Completing a row (status=complete) sets accounts.account_manager to to_account_manager when that value is set. Reopening does not revert the account AM. Does not write riders or programs.';
COMMENT ON FUNCTION public.account_transition_complete_sync_am() IS
  'On first transition to complete, copy incoming AM onto accounts.account_manager for this account_id only, and append an audit comment when the value actually changes.';

REVOKE ALL ON FUNCTION public.account_transition_complete_sync_am() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_transition_complete_sync_am() TO authenticated, service_role;

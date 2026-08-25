-- Hit date for Account Transition milestones. Nullable; never inferred from created_at or done.
ALTER TABLE public.account_transition_milestones
  ADD COLUMN IF NOT EXISTS milestone_date date;

COMMENT ON COLUMN public.account_transition_milestones.milestone_date IS
  'When the milestone was actually hit. Nullable; not inferred from created_at or done.';

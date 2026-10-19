-- Pinned saved-view tiles count fixed lists in one query.
-- Query views still rerun through the existing railcar filters.
-- Does not write car_lists, car_list_members, railcars, or rent_events.
-- Does not replace rlms_undo_change_group, rlms_apply_jsonb_patch,
-- or rlms_program_car_is_program_done.
-- Bruce applies this after sign-off. The server falls back to a member
-- read if this function is not present yet.

CREATE OR REPLACE FUNCTION public.rlms_saved_view_member_counts(p_list_ids int[])
RETURNS TABLE(list_id int, active_count bigint, inactive_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT m.list_id,
         count(*) FILTER (WHERE r.active IS DISTINCT FROM false) AS active_count,
         count(*) FILTER (WHERE r.active IS FALSE) AS inactive_count
  FROM public.car_list_members m
  JOIN public.railcars r ON r.id = m.railcar_id
  WHERE m.removed_at IS NULL
    AND m.list_id = ANY (COALESCE(p_list_ids, ARRAY[]::int[]))
  GROUP BY m.list_id;
$$;

REVOKE ALL ON FUNCTION public.rlms_saved_view_member_counts(int[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_saved_view_member_counts(int[]) TO service_role;

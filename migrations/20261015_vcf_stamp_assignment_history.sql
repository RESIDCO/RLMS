CREATE OR REPLACE FUNCTION public.vcf_stamp_assignment_history(p_load uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.assignment_history ah
  SET last_seen_load_id = p_load,
      valid_car_id_ext = NULLIF(x.vcid, '')
  FROM jsonb_to_recordset(p_rows) AS x(id integer, vcid text)
  WHERE ah.id = x.id
    AND ah.last_seen_load_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vcf_stamp_assignment_history(uuid, jsonb) TO service_role;

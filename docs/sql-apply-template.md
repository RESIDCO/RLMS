# One-off SQL apply template

Every tracker-style / MCP / psql write that changes production rows must log `activity_log` in the **same statement** (CTE) as the data change. Use one `change_group` per apply bundle.

```sql
-- replace :group with gen_random_uuid() once per bundle and reuse it
with updated as (
  update railcars r
     set /* columns */
  from (values
    -- (id, ...)
  ) v(id /* , ... */)
  where r.id = v.id
    and r.active is true
  returning r.id, /* changed cols */
),
logged as (
  insert into activity_log (
    entity_type, entity_id, railcar_id, action,
    table_name, row_pk, before, after,
    change_group, undoable, actor, source, detail, occurred_at
  )
  select
    'railcar', u.id, u.id, 'sql_apply',
    'railcars', u.id,
    jsonb_build_object(/* prior keys */),
    jsonb_build_object(/* new keys */),
    :group::uuid,
    true,
    'user',
    'sql_apply_YYYYMMDD',
    jsonb_build_object('op', 'update'),
    now()
  from updated u
  returning id
)
select count(*) as logged from logged;
```

Rules:

- Capture **before** values (select or `from` join) for every key you write.
- `undoable=false` for remarks, imports, and anything Phase 2 must refuse.
- Do not deactivate Sold. Do not set `RLMS_RECOMPUTE_FLEET_STATUS`. Leave `trg_recompute` disabled.
- Do not touch RepairSMART.

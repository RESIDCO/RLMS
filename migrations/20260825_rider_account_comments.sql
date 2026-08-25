-- Replace unused riders.account_mgmt_comment with an append-only OL comment log.
-- Confirmed zero production rows on the dropped column before this migration.

alter table riders drop column if exists account_mgmt_comment;

create table if not exists rider_account_comments (
  id              bigint generated always as identity primary key,
  rider_id        bigint not null references riders(id) on delete cascade,
  author_user_id  uuid references auth.users(id),
  author_email    text not null,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rider_account_comments_rider_id
  on rider_account_comments (rider_id, created_at desc);

comment on table rider_account_comments is
  'Append-only account-manager observations on an OL. Set only from Account Management. Never written by any import. Entries are never edited once posted; admin-only hard delete is the escape hatch.';

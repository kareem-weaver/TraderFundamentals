-- TraderFundamentals leaderboard.
-- Paste this into the Supabase SQL editor and run it once.
--
-- There is no login. A group is identified by the SHA-256 digest of its
-- passphrase, computed in the browser, so the passphrase itself is never sent
-- or stored. That keeps groups apart; it is not a security boundary. Anyone
-- holding the anon key can read this table, and because scoring happens in the
-- browser a determined visitor can insert a score they did not earn.

create table if not exists public.scores (
  id           bigint generated always as identity primary key,
  board        text        not null,
  bucket       text        not null,
  name         text        not null,
  score        numeric     not null,
  accuracy     numeric     not null default 0,
  wpm          numeric     not null default 0,
  taken        integer     not null default 0,
  escaped      integer     not null default 0,
  longest_run  integer     not null default 0,
  style        text        not null,
  mode         text        not null,
  intensity    text,
  duration_ms  integer,
  list_name    text,
  created_at   timestamptz not null default now()
);

create index if not exists scores_board_bucket_idx
  on public.scores (board, bucket, score desc);

alter table public.scores enable row level security;

-- Reads are open: the board digest is what keeps one group's rows out of
-- another group's view.
drop policy if exists "read scores" on public.scores;
create policy "read scores"
  on public.scores for select
  using (true);

-- Writes are open too, but shaped: this rejects blank names, absurd values and
-- anything that is obviously not a real submission.
drop policy if exists "post scores" on public.scores;
create policy "post scores"
  on public.scores for insert
  with check (
    char_length(name)  between 1 and 24
    and char_length(board)  between 8 and 64
    and char_length(bucket) between 3 and 64
    and score    >= 0 and score    <= 100000
    and accuracy >= 0 and accuracy <= 100
    and wpm      >= 0 and wpm      <= 100000
    and style in ('tape', 'single')
  );

-- Nobody edits or deletes through the anon key; no update/delete policy exists.

-- Optional: keep the table small by dropping runs older than 90 days.
-- Schedule with pg_cron, or just run it by hand now and then.
-- delete from public.scores where created_at < now() - interval '90 days';

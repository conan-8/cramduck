-- 005_leaderboard.sql — global leaderboard. Idempotent: safe to re-run.
--
-- One row per student. The dashboard (cramduck-mockup) upserts the cached
-- stats from student_events when the board is viewed; the row only exists
-- once the student picks a leaderboard username + region.
--
-- RLS posture: the board is public read (usernames + stats are meant to be
-- shown to everyone); only the owner may insert/update their own row.

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  student_id         UUID PRIMARY KEY,  -- auth.users.id
  username           TEXT NOT NULL CHECK (char_length(username) BETWEEN 3 AND 16),
  region             TEXT NOT NULL DEFAULT '',  -- ISO 3166-1 alpha-2, '' = globe
  questions_answered INT  NOT NULL DEFAULT 0 CHECK (questions_answered >= 0),
  best_score         INT  NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  time_ms            BIGINT NOT NULL DEFAULT 0 CHECK (time_ms >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- usernames are unique case-insensitively
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_entries_username_key
  ON leaderboard_entries (lower(username));

ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- anyone may read the board
DROP POLICY IF EXISTS "public read" ON leaderboard_entries;
CREATE POLICY "public read" ON leaderboard_entries
  FOR SELECT TO anon, authenticated USING (true);

-- owners write only their own row
DROP POLICY IF EXISTS "own row insert" ON leaderboard_entries;
CREATE POLICY "own row insert" ON leaderboard_entries
  FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "own row update" ON leaderboard_entries;
CREATE POLICY "own row update" ON leaderboard_entries
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

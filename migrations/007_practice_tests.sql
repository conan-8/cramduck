-- 007_practice_tests.sql — pre-built adaptive practice tests.
-- Idempotent: safe to re-run.
--
-- Each row in practice_tests is one full digital-SAT-shaped test assembled
-- offline by scripts/build-practice-tests.ts from harvested_questions.
-- A test always carries SIX modules of content: per section, module 1
-- (tier='mixed') plus BOTH module-2 variants (tier='easy' and tier='hard'),
-- so the simulator can route to easy/hard module 2 based on module-1 score
-- (Princeton Review thresholds: RW >= 15/27, Math >= 14/22).
--
-- Series partition the bank by origin with zero question reuse:
--   series='A' — origin='question_bank' (labels A1, A2, ...)
--   series='B' — origin='bluebook'      (labels B1, B2, ...)
-- practice_test_questions.source_id is globally UNIQUE: a bank question
-- appears in at most one practice test, ever.

CREATE TABLE IF NOT EXISTS practice_tests (
  id         BIGSERIAL PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,               -- A1..An / B1..Bn
  series     TEXT NOT NULL CHECK (series IN ('A', 'B')),
  origin     TEXT NOT NULL CHECK (origin IN ('question_bank', 'bluebook')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_test_questions (
  test_id   BIGINT NOT NULL REFERENCES practice_tests(id) ON DELETE CASCADE,
  source_id TEXT   NOT NULL REFERENCES harvested_questions(source_id),
  section   TEXT   NOT NULL CHECK (section IN ('reading-writing', 'math')),
  module    INT    NOT NULL CHECK (module IN (1, 2)),
  tier      TEXT   NOT NULL CHECK (tier IN ('mixed', 'easy', 'hard')),
  position  INT    NOT NULL,                     -- 1-based order within the module
  PRIMARY KEY (test_id, section, module, tier, position),
  UNIQUE (source_id)                             -- zero repeats across all tests
);

ALTER TABLE practice_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_test_questions ENABLE ROW LEVEL SECURITY;

-- DEV-ONLY anon read for the local simulator — PRE-LAUNCH TODO: drop these.
DROP POLICY IF EXISTS "dev simulator read" ON practice_tests;
CREATE POLICY "dev simulator read" ON practice_tests FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "dev simulator read" ON practice_test_questions;
CREATE POLICY "dev simulator read" ON practice_test_questions FOR SELECT TO anon USING (true);

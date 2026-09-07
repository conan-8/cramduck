-- 009_authenticated_content_read.sql
--
-- The cramduck dashboard swaps the anon key for the signed-in user's JWT
-- (requests run as the `authenticated` role). The content tables only had an
-- anon read policy, so signed-in views (Mistakes & Saved, sim sessions, skill
-- map) got zero rows and fell back to rendering raw source ids (ssqb-<hex>)
-- instead of the practice-test display ids (A2-RW2-Q20).
--
-- Content is already world-readable via anon — extending the same read to
-- authenticated changes nothing security-wise. PRE-LAUNCH TODO stands.

DROP POLICY IF EXISTS "dev simulator read" ON harvested_questions;
CREATE POLICY "dev simulator read" ON harvested_questions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dev simulator read" ON practice_tests;
CREATE POLICY "dev simulator read" ON practice_tests FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dev simulator read" ON practice_test_questions;
CREATE POLICY "dev simulator read" ON practice_test_questions FOR SELECT TO anon, authenticated USING (true);

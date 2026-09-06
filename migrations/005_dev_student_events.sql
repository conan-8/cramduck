-- 005_dev_student_events.sql — dev-only anon read/write on student_events so the
-- local simulator + zen mode can record answers and the Cramduck dashboard can
-- read them back. Fixed student_id 'dev' keeps the blast radius tiny.
--
-- PRE-LAUNCH TODO: drop this policy; replace with owner-scoped auth policies
-- once real accounts exist (mirrors the bluebook_questions dev posture).

ALTER TABLE student_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev student events" ON student_events;
CREATE POLICY "dev student events" ON student_events
  FOR ALL TO anon
  USING (student_id = 'dev')
  WITH CHECK (student_id = 'dev');

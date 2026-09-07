-- 008_chat_history.sql — persisted coach chat threads + messages.
-- Idempotent: safe to re-run.
--
-- One chat_threads row per conversation, owned by the signed-in user.
-- chat_messages holds the transcript (role: user | assistant). The dashboard
-- (cramduck-mockup/index.html) creates a thread lazily on the first user
-- message and appends each turn as it streams in.

CREATE TABLE IF NOT EXISTS chat_threads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_user_idx
  ON chat_threads (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
  ON chat_messages (thread_id, created_at);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat threads owner all" ON chat_threads;
CREATE POLICY "chat threads owner all" ON chat_threads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "chat messages owner all" ON chat_messages;
CREATE POLICY "chat messages owner all" ON chat_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid()
    )
  );

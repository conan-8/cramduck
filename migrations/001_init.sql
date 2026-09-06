-- 001_init.sql — initial Cramduck schema. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS subjects (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  exam_mode   TEXT NOT NULL,
  family      TEXT NOT NULL CHECK (family IN ('SAT', 'AP')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS taxonomy_nodes (
  code                TEXT PRIMARY KEY,
  subject_code        TEXT NOT NULL REFERENCES subjects(code),
  kind                TEXT NOT NULL CHECK (kind IN ('domain', 'skill', 'unit', 'topic', 'learning_objective', 'skill_code')),
  title               TEXT NOT NULL,
  slug                TEXT NOT NULL,
  description         TEXT NOT NULL,
  parent_code         TEXT REFERENCES taxonomy_nodes(code),
  exam_weight_percent NUMERIC(5,2),
  sort_order          INT NOT NULL,
  UNIQUE (subject_code, slug)
);

CREATE TABLE IF NOT EXISTS misconceptions (
  id                TEXT PRIMARY KEY,
  taxonomy_code     TEXT NOT NULL REFERENCES taxonomy_nodes(code),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  detection_signal  TEXT NOT NULL,
  remediation_note  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagram_archetypes (
  archetype_id        TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  subjects_applicable TEXT[] NOT NULL,
  params_schema       JSONB NOT NULL,
  renderer_ref        TEXT NOT NULL,
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS archetypes (
  slug          TEXT PRIMARY KEY,
  subject_code  TEXT NOT NULL REFERENCES subjects(code),
  taxonomy_code TEXT NOT NULL REFERENCES taxonomy_nodes(code),
  spec          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id              TEXT PRIMARY KEY,
  subject_code    TEXT NOT NULL REFERENCES subjects(code),
  current_version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS question_versions (
  question_id     TEXT NOT NULL REFERENCES questions(id),
  version         INT NOT NULL,
  payload         JSONB NOT NULL,
  taxonomy_code   TEXT NOT NULL REFERENCES taxonomy_nodes(code),
  archetype_slug  TEXT REFERENCES archetypes(slug),
  difficulty      INT,
  review_status   TEXT NOT NULL CHECK (review_status IN ('pending', 'approved', 'rejected')),
  allowed_uses    TEXT[] NOT NULL,
  provenance      JSONB,
  content_hash    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, version)
);

CREATE TABLE IF NOT EXISTS student_events (
  id               BIGSERIAL PRIMARY KEY,
  student_id       TEXT NOT NULL,
  question_id      TEXT NOT NULL,
  question_version INT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('exam', 'practice', 'diagnostic')),
  idk              BOOLEAN NOT NULL,
  choice_id        CHAR(1),
  grid_in_answer   TEXT,
  correct          BOOLEAN NOT NULL,
  time_ms          INT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mastery (
  student_id                TEXT NOT NULL,
  taxonomy_code             TEXT NOT NULL REFERENCES taxonomy_nodes(code),
  attempts                  INT NOT NULL DEFAULT 0,
  correct                   INT NOT NULL DEFAULT 0,
  idk_count                 INT NOT NULL DEFAULT 0,
  recency_weighted_accuracy NUMERIC(4,3),
  last_seen_at              TIMESTAMPTZ,
  PRIMARY KEY (student_id, taxonomy_code)
);

CREATE TABLE IF NOT EXISTS misconception_stats (
  student_id       TEXT NOT NULL,
  misconception_id TEXT NOT NULL REFERENCES misconceptions(id),
  hits             INT NOT NULL DEFAULT 0,
  last_hit_at      TIMESTAMPTZ,
  PRIMARY KEY (student_id, misconception_id)
);

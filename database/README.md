# Database (data files)

Validated, seed-ready data for the Cramduck content layer. Everything here is
plain JSON checked into Git; `schemas/` holds the contracts, `scripts/` holds
the validators and the seed that loads these files into Postgres.

## Layout

```
database/
├── exam_format.schema.json      ← contract for per-subject exam_format.json
├── SAT_MATH/
│   ├── exam_format.json         ← sections, timing, question counts, domain weights, policies
│   ├── taxonomy.json            ← domains → skills (nodes[] with code/kind/slug/parentCode)
│   └── misconceptions.json      ← distractor-wiring + remediation library
├── SAT_RW/
│   ├── exam_format.json
│   ├── taxonomy.json
│   └── misconceptions.json
└── diagrams/                    ← diagram archetype registry (shared across subjects)
    └── sat-math:graph-line.json ← one file per figure type: paramsSchema + rendererRef
```

Current counts: 2 subjects, 38 taxonomy nodes, 139 misconceptions,
13 diagram archetypes.

## Naming rules

- Subject folders use the canonical subject code: `SAT_MATH`, `SAT_RW`
  (future: `AP_*`). Pattern: `^(AP|SAT)_[A-Z0-9_]+$`.
- Taxonomy node codes and misconception IDs are subject-scoped:
  `<SUBJECT>:<slug>` (e.g. `SAT_RW:transitions`,
  `SAT_MATH:percentages-decimal-point-slip`).
- Diagram archetype files are named by their ID, lowercase
  `<family>:<name>.json` (e.g. `sat-math:graph-system-two-lines.json`).
  The matching SVG renderers live in `src/renderers/` (see
  `src/renderers/README.md`).
- Question-generation archetypes live with the research material, not here:
  `research/sat/archetypes/<section>/<slug>.json` (+ `.md` worked example).

## Data flow

```
database/ + research/sat/  →  npm run validate:all  →  npm run db:check
                            →  npm run db:migrate     →  npm run seed  →  Supabase Postgres
```

The target database is **Supabase (managed Postgres)**; there is no local
database to start. Set `DATABASE_URL` in `.env` to the URI from Supabase
Dashboard → Project → Connect (Session pooler or Direct connection, port
5432 — see `.env.example`).

1. **Validators** (`scripts/validate-*.ts`) check every file against its
   schema plus cross-references (misconceptions → taxonomy codes, generated
   questions → taxonomy / misconceptions / diagram `paramsSchema`).
2. **Check** (`npm run db:check`) verifies connectivity to the Supabase
   Postgres and prints the server version — a real non-zero exit code when
   it can't connect, with setup guidance.
3. **Migrate** (`npm run db:migrate`) applies `migrations/*.sql`
   (tables: subjects, taxonomy_nodes, misconceptions, diagram_archetypes,
   archetypes, questions, question_versions, student_events, mastery,
   misconception_stats, bluebook_questions).
4. **Seed** (`npm run seed`) upserts all of it — subjects from
   `exam_format.json`, taxonomy nodes, misconceptions, diagram archetypes,
   archetypes (whole file as spec JSONB), and approved generated questions
   from `research/sat/test-fixtures/generated-*.json`. Seeding is idempotent
   (`ON CONFLICT DO UPDATE`).

## Question stores: three kinds

The question bank is deliberately partitioned into three kinds:

- **Generated questions** (ours, license-safe, `allowedUses:
  ["display"]`) live in `questions` + `question_versions` with
  `source = 'generated'` — seeded from approved drafts under
  `research/sat/generated/` and `research/sat/test-fixtures/generated-*.json`.
- **General bank questions** (online SSQB items, `origin =
  'question_bank'`) and **Bluebook questions** (SSQB items that appear in
  Bluebook practice exams, `origin = 'bluebook'`) live together in the
  separate `harvested_questions` table, split by the `origin` column.
  Both are College Board content: `allowedUses: ["internal_eval"]` only —
  never shown to students. Seeded from `research/sat/question-bank/*.json`
  (gitignored; the harvester is planned but not built — see
  `research/sat/README.md`); the five `ssqb-fixture-*` records under
  `research/sat/test-fixtures/` were seeded as the initial content (all
  `question_bank`). The table has RLS enabled; migrations/004 carries a
  **dev-only anon read policy** so the local simulator can show them —
  PRE-LAUNCH TODO: drop that policy.

## Pre-built adaptive practice tests

`practice_tests` + `practice_test_questions` (migrations/007) hold full
digital-SAT-shaped tests assembled offline from `harvested_questions` by
`npm run build:tests` (scripts/build-practice-tests.ts, seeded RNG). Each
test carries SIX modules: per section, module 1 (`tier='mixed'`) plus BOTH
module-2 variants (`tier='easy'` / `tier='hard'`), so the simulator routes
to easy/hard module 2 on module-1 score (Princeton Review thresholds:
RW ≥ 15/27, Math ≥ 14/22). Real format per module: RW 27 questions / 32 min,
Math 22 / 35 min with ~5 grid-ins; domain quotas follow the official
blueprint (RW 8/7/7/5, Math 8/8/3/3).

- **Series A** (`origin='question_bank'`) — labels A1…A9
- **Series B** (`origin='bluebook'`) — labels B1…B13
- `practice_test_questions.source_id` is globally UNIQUE: zero question
  reuse across tests. Re-running `build:tests` wipes and rebuilds a series.

## Simulator / web-client access (PostgREST)

The simulator HTML reads **live from Supabase** with the publishable anon key
(migrations/003 sets the policies):

```js
const SUPABASE_URL = 'https://asnrquijopjjqfjvwalc.supabase.co';
const ANON_KEY = '<publishable key>'; // Project → Settings → API
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

// Generated bank (new questions) — display only, approved versions:
const generated = await fetch(
  `${SUPABASE_URL}/rest/v1/question_versions?select=question_id,payload,difficulty,taxonomy_code&review_status=eq.approved`,
  { headers: H }).then(r => r.json());

// Harvested bank (SSQB-sourced, internal_eval) — split by origin:
const harvested = await fetch(
  `${SUPABASE_URL}/rest/v1/harvested_questions?select=source_id,origin,payload,skill,difficulty_internal`,
  { headers: H }).then(r => r.json());
//   origin = 'bluebook'      → appears in a Bluebook practice exam
//   origin = 'question_bank' → general online question-bank item
```

Toggle semantics the simulator should implement:

- **Generated** — items from `question_versions` only.
- **Bank** — `harvested_questions` where `origin=eq.question_bank`.
- **Bluebook** — `harvested_questions` where `origin=eq.bluebook`.
- **Exclude Bluebook** switch — in any mixed view, drop items with
  `payload.allowedUses` including `internal_eval` AND `origin='bluebook'`
  (or, stricter, any internal_eval item — decide per view).

Rendering inside the simulator:

- Math text (stem/choices/rationale/stimulus) is inline LaTeX — load KaTeX
  from CDN and auto-render `\( ... \)` spans.
- Figures: `payload.stimulus.diagram` holds `{archetypeId, parameters}`.
  Render with the prebuilt bundle: `npm run build:sim` produces
  `bluebook-mockup/public/renderers.js` (gitignored; IIFE global
  `CramduckRenderers`; `npm run build:app` copies it into the served app):
  ```js
  const d = payload.stimulus.diagram;
  container.innerHTML = CramduckRenderers.render(d.archetypeId, d.parameters);
  ```
- Bluebook items reference figure files (`stimulus.figureAsset`) instead of
  parameterized diagrams — those assets live under `research/sat/assets/`
  (gitignored, harvested-only); show a placeholder when a figureAsset is
  missing.
5. If the database is unreachable (`DATABASE_URL` unset or the Supabase
   project not responding), `db:migrate` and `seed` print a PENDING-DEPLOY
   message with the exact commands and exit 0 — the pipeline never hard-fails
   on a not-yet-provisioned database. This fallback depends only on
   `DATABASE_URL` reachability, not on any local service.

### Supabase notes

- The tables in `migrations/001_init.sql` map 1:1 onto a Supabase project's
  Postgres — no schema changes needed; migrations run as plain SQL.
- Scripts (`db:check`, `db:migrate`, `seed`) connect with plain `pg` over the
  session/direct connection — no Supabase client library required for the
  data layer.
- When the app ships, runtime reads go through `supabase-js` with Row Level
  Security: public-read for display content (questions, diagrams) and
  owner-only for student data (`student_events`, `mastery`,
  `misconception_stats`). RLS policies are a future concern — noted here so
  the table design keeps it in mind, not designed in depth yet.
- Supabase Storage buckets (future): a private bucket with short-lived
  signed URLs for scan-and-grade image uploads; a public bucket for
  generated diagram SVGs / rendered assets.

## Adding a subject (AP expansion)

Create `database/<NEW_SUBJECT>/` with the same three files
(`exam_format.json`, `taxonomy.json`, `misconceptions.json`). The validators
and seed discover subjects by scanning `database/` for folders containing
`exam_format.json` — no code changes needed. AP taxonomies use the
units → topics → learning objectives shape already supported by
`schemas/taxonomy.schema.json`.

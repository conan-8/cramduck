import type { ExamModule, Question } from '../types/exam'
import { supabase } from '../lib/supabase'
import { assetUrl } from '../lib/assets'

/**
 * Live question bank — replaces the static lorem-ipsum data/exam.ts TEST.
 *
 * Three question kinds, per the product's store partition:
 *   generated — our original questions (Supabase question_versions, display)
 *   bank      — online SSQB items (harvested_questions, origin=question_bank)
 *   bluebook  — SSQB items that appear in Bluebook practice exams
 *               (harvested_questions, origin=bluebook)
 *
 * Content text uses \( ... \) inline LaTeX (rendered by RichText/KaTeX) and
 * <u>...</u> underline markup (converted to the mockup's [[...]] markup).
 * Diagrams carry { archetypeId, parameters } and render through the
 * parameterized SVG renderer bundle.
 *
 * Curated layer: harvested records may carry payload.curated (imported from
 * the human curation workbook, research/sat/curate/) — those render VERBATIM
 * with info/prompt/options/diagram mapped 1:1 to screen regions, bypassing
 * the reflow/bulleting heuristics below.
 */

const SUPABASE_URL = 'https://asnrquijopjjqfjvwalc.supabase.co'
const ANON_KEY = 'sb_publishable_qg5QMNLb-D-BelY5G27kYA_UnZU0Hxh'
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }

export type SourceKind = 'generated' | 'bank' | 'bluebook'

interface RawGenerated {
  question_id: string
  payload: {
    questionType: 'mcq' | 'grid_in'
    stimulus?: { type?: string; text?: string | null; tableJson?: TableJson | null; diagram?: LiveDiagram | null }
    stem: string
    choices?: Array<{ id: string; text: string }>
    correctAnswer: string
    taxonomyCode: string
    rationale?: string
  }
}

/** Human-curated display-ready block (payload.curated) — fields map 1:1 to
 *  simulator regions and are rendered VERBATIM: no reflow, no bulleting, no
 *  stem-splitting. Author markup: \( \) LaTeX, [[ ]] underline, **bold**,
 *  *italic*, blank line = paragraph. */
interface CuratedBlock {
  section: 'reading-writing' | 'math'
  domain: string
  skill: string
  difficultyInternal: number
  info: string | null
  prompt: string
  options: Array<{ id: string; text: string }>
  gridAnswer: string | null
  correctAnswer: string
  rationale: string | null
  diagram: string | null
  tableJson?: TableJson | null
  review?: { status: 'approved' | 'returned'; reasons?: string[]; note?: string | null; at: string }
}

interface RawHarvested {
  source_id: string
  origin: 'bluebook' | 'question_bank'
  payload: {
    questionType: 'mcq' | 'grid_in'
    section: 'reading-writing' | 'math'
    domain: string
    skill: string
    difficultyInternal: number
    stimulus?: { type?: string; text?: string | null; tableJson?: TableJson | null; figureAsset?: string | null }
    stem: string
    choices?: Array<{ id: string; text: string }>
    correctAnswer: string
    rationale?: string
    curated?: CuratedBlock
  }
}

interface TableJson {
  caption?: string
  columns?: string[]
  headers?: string[]
  rows?: Array<Array<string | number>>
}

interface LiveDiagram {
  archetypeId: string
  parameters: Record<string, unknown>
}

export interface BankQuestion extends Question {
  kind: SourceKind
  section: 'rw' | 'math'
  difficulty: number
  /** Archetype/skill slug — the canonical categorization (same namespace as
   *  the 30 generator archetypes). */
  archetype: string
  domain: string
  /** Vision-transcribed bank items carry provenance { verified: true }. */
  verified?: boolean
  /** Curated records only: true once approved in the /review tool. Curated
   *  questions enter the simulator pools only when approved. */
  approved?: boolean
}

/** <u>x</u> → [[x]] so the mockup's RichText underlines it. */
function underlines(text: string): string {
  return text.replace(/<u>(.+?)<\/u>/g, '[[$1]]')
}

const SPEAKER_RX = /^[A-Z][A-Z' .]{1,24}:/
const VERSE_RX = /\b(poem|poetry|sonnet|verse|play|drama)\b/i

/** Notes passages (rhetorical synthesis): guarantee one bulleted line per
 *  note. Wrapped continuation fragments (start with punctuation/lowercase)
 *  are folded back into the previous note. */
function bulletNotes(text: string): string {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l) {
      out.push('')
      continue
    }
    if (l.startsWith('•') || l.startsWith('-') || l.startsWith('–')) {
      out.push(l)
      continue
    }
    if (/^(While researching|A student|The student)/.test(l)) {
      out.push(l)
      continue
    }
    if ((/^[.,"'”’)]/.test(l) || /^[a-z]/.test(l)) && out.length) {
      out[out.length - 1] += ` ${l}`
      continue
    }
    out.push(`• ${l}`)
  }
  return out.join('\n')
}

/** Hard-wrapped PDF prose: join lines so the text reflows to the pane width
 *  when the divider is dragged. Verse and plays keep their line breaks;
 *  Text headings and speaker labels always start a new paragraph. */
function reflow(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
  if (lines.length <= 1) return text.trim()
  if (VERSE_RX.test(text.slice(0, 250))) return lines.join('\n')
  const blocks: string[] = []
  let cur = ''
  const flush = () => {
    if (cur) {
      blocks.push(cur)
      cur = ''
    }
  }
  for (const l of lines) {
    if (l.startsWith('**Text') || SPEAKER_RX.test(l)) {
      flush()
      cur = l
      continue
    }
    if (cur && cur.length >= 40 && !cur.startsWith('**')) cur = `${cur} ${l}`
    else {
      flush()
      cur = l
    }
  }
  flush()
  return blocks.join('\n\n')
}

/** Passage cleanup: bold Text 1/Text 2 headings, bullet the notes passages,
 *  and unwrap hard-broken prose so lines always fit the pane. */
function formatPassage(text: string, archetype: string): string {
  const t = underlines(text).replace(/^(Text\s+\w+)\s*$/gm, '**$1**')
  return archetype === 'rhetorical-synthesis' ? bulletNotes(t) : reflow(t)
}

function prettyTaxonomy(code: string): string {
  const slug = code.includes(':') ? code.split(':')[1]! : code
  return slug
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function toQuestion(
  id: string,
  kind: SourceKind,
  section: 'rw' | 'math',
  skill: string,
  archetype: string,
  domain: string,
  difficulty: number,
  payload: RawGenerated['payload'] | RawHarvested['payload'],
): BankQuestion {
  const stim = payload.stimulus
  const diagram = (stim as RawGenerated['payload']['stimulus'])?.diagram
  const rawTable = stim?.tableJson
  const table = rawTable
    ? {
        caption: rawTable.caption,
        columns: rawTable.columns ?? rawTable.headers ?? [],
        rows: rawTable.rows ?? [],
      }
    : undefined
  const rawImage = (stim as RawHarvested['payload']['stimulus'])?.figureAsset
  const imageAsset = rawImage ? assetUrl(rawImage) : undefined
  const verified = (payload as { provenance?: { verified?: boolean } }).provenance?.verified === true
  return {
    id,
    kind,
    section,
    difficulty,
    skill,
    archetype,
    domain,
    verified,
    prompt: payload.stem,
    passage: stim?.text ? formatPassage(stim.text, archetype) : undefined,
    table,
    options: payload.choices?.map((c) => c.text),
    correct: payload.correctAnswer,
    rationale: payload.rationale ?? undefined,
    diagram: diagram ? { live: { archetypeId: diagram.archetypeId, parameters: diagram.parameters } } : undefined,
    imageAsset,
  }
}

/** Curated records render verbatim — the authoring sheet is the source of
 *  truth for what lands in each pane, so none of the layout heuristics
 *  (reflow/bulletNotes/underlines) apply. */
function toCuratedQuestion(r: RawHarvested, c: CuratedBlock): BankQuestion {
  const table = c.tableJson
    ? {
        caption: c.tableJson.caption,
        columns: c.tableJson.columns ?? c.tableJson.headers ?? [],
        rows: c.tableJson.rows ?? [],
      }
    : undefined
  return {
    id: r.source_id,
    kind: r.origin === 'bluebook' ? 'bluebook' : 'bank',
    section: c.section === 'reading-writing' ? 'rw' : 'math',
    difficulty: c.difficultyInternal,
    skill: `${c.domain} — ${prettyTaxonomy(c.skill)}`,
    archetype: c.skill,
    domain: c.domain,
    verified: true,
    approved: c.review?.status === 'approved',
    prompt: c.prompt,
    passage: c.info ?? undefined,
    table,
    options: c.options.length > 0 ? c.options.map((o) => o.text) : undefined,
    correct: c.correctAnswer,
    // ?v= busts browser caches that still hold the pre-fix broken SVGs
    imageAsset: c.diagram ? `${assetUrl(c.diagram)}?v=2` : undefined,
  }
}

const PAGE_SIZE = 1000 // PostgREST server-side row cap per request

/** PostgREST silently caps each response at PAGE_SIZE rows — page with
 *  offset until a short page arrives so the whole bank is fetched. */
async function fetchAllPages(url: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await fetch(`${url}&offset=${offset}&limit=${PAGE_SIZE}`, { headers: H })
    const page: unknown = await res.json()
    if (!Array.isArray(page)) return [] // error payload — treat as empty
    out.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return out
}

let cache: { generated: BankQuestion[]; harvested: BankQuestion[] } | null = null

export async function fetchBank(): Promise<{ generated: BankQuestion[]; harvested: BankQuestion[] }> {
  if (cache) return cache
  const [g, h] = await Promise.all([
    fetchAllPages(`${SUPABASE_URL}/rest/v1/question_versions?select=question_id,payload&review_status=eq.approved`),
    fetchAllPages(`${SUPABASE_URL}/rest/v1/harvested_questions?select=source_id,origin,payload`),
  ])
  const generated: BankQuestion[] = (g as RawGenerated[]).map((r) =>
    toQuestion(
      r.question_id,
      'generated',
      r.payload.taxonomyCode.startsWith('SAT_RW') ? 'rw' : 'math',
      prettyTaxonomy(r.payload.taxonomyCode),
      r.payload.taxonomyCode.split(':')[1] ?? '',
      '',
      3,
      r.payload,
    ),
  )
  const harvested: BankQuestion[] = (h as RawHarvested[]).map((r) =>
    r.payload.curated
      ? toCuratedQuestion(r, r.payload.curated)
      : toQuestion(
          r.source_id,
          r.origin === 'bluebook' ? 'bluebook' : 'bank',
          r.payload.section === 'reading-writing' ? 'rw' : 'math',
          `${r.payload.domain} — ${prettyTaxonomy(r.payload.skill)}`,
          r.payload.skill,
          r.payload.domain,
          r.payload.difficultyInternal,
          r.payload,
        ),
  )
  cache = { generated, harvested }
  return cache
}

/** Questions for one source selection (excludeBluebook drops bluebook items;
 *  verifiedOnly keeps only items with a verified vision transcription). */
export function selectQuestions(
  bank: { generated: BankQuestion[]; harvested: BankQuestion[] },
  source: SourceKind,
  excludeBluebook: boolean,
  verifiedOnly = false,
): BankQuestion[] {
  const onlyVerified = (qs: BankQuestion[]): BankQuestion[] =>
    verifiedOnly ? qs.filter((q) => q.verified === true) : qs
  if (source === 'generated') return onlyVerified(bank.generated)
  // curated records (approved !== undefined) require approval; non-curated
  // records (math, fixtures) keep the current behavior until curated.
  let items = bank.harvested.filter((q) => q.approved === undefined || q.approved === true)
  if (excludeBluebook) items = items.filter((q) => q.kind !== 'bluebook')
  return onlyVerified(items.filter((q) => q.kind === source))
}

/** Correctness check shared by the sim (exam scoring) and zen (check-as-you-go).
 *  MCQ compares option letters; grid-in compares numeric value with fraction
 *  and tolerance handling. */
export function isCorrect(question: { options?: string[]; correct: string }, value: string): boolean {
  if (question.options) return value === question.correct
  const norm = (s: string): number => {
    const t = s.trim()
    if (!t) return NaN
    if (t.includes('/')) {
      const [a, b] = t.split('/')
      return Number(a) / Number(b)
    }
    return Number(t)
  }
  const a = norm(value)
  const b = norm(question.correct)
  if (Number.isNaN(a) || Number.isNaN(b)) return value.trim() === question.correct.trim()
  return Math.abs(a - b) < 1e-6
}

export interface StudentEventInput {
  question_id: string
  correct: boolean
  mode: 'exam' | 'practice' | 'diagnostic'
  time_ms: number
  choice_id?: string
  grid_in_answer?: string
}

/** Record answered questions to Supabase student_events, owned by the
 *  signed-in account (student_id = auth.uid(), enforced by RLS). */
export async function postEvents(events: StudentEventInput[]): Promise<void> {
  if (events.length === 0) return
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return
  const now = new Date().toISOString()
  const body = events.map((e) => ({
    student_id: userId,
    question_id: e.question_id,
    question_version: 1,
    mode: e.mode,
    idk: false,
    choice_id: e.choice_id ?? null,
    grid_in_answer: e.grid_in_answer ?? null,
    correct: e.correct,
    time_ms: e.time_ms,
    occurred_at: now,
  }))
  await supabase.from('student_events').insert(body)
}

export interface SessionEvent {
  question_id: string
  correct: boolean
  mode: 'exam' | 'practice' | 'diagnostic'
  time_ms: number
  choice_id: string | null
  grid_in_answer: string | null
  occurred_at: string
}

/** Events for one past session (the hub's simulator tab boxes) — the window
 *  is [start, end] inclusive, ordered by insertion. RLS scopes the read to
 *  the signed-in student. */
export async function fetchSessionEvents(startIso: string, endIso: string): Promise<SessionEvent[]> {
  const { data } = await supabase
    .from('student_events')
    .select('question_id,correct,mode,time_ms,choice_id,grid_in_answer,occurred_at')
    .gte('occurred_at', startIso)
    .lte('occurred_at', endIso)
    .order('id', { ascending: true })
  return (data ?? []) as SessionEvent[]
}

/** Practice-test display ids (A2-RW2-Q20 / B3-M1-Q6) for a set of bank
 *  question ids. Questions outside any pre-built test are simply absent. */
export async function fetchDisplayIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const enc = ids.map((i) => encodeURIComponent(i)).join(',')
  const rows = (await fetchAllPages(
    `${SUPABASE_URL}/rest/v1/practice_test_questions?source_id=in.(${enc})&select=source_id,section,module,position,practice_tests!inner(label)`,
  )) as Array<{
    source_id: string
    section: 'reading-writing' | 'math'
    module: 1 | 2
    position: number
    practice_tests: { label: string }
  }>
  for (const r of rows) {
    const code = r.section === 'reading-writing' ? `RW${r.module}` : `M${r.module}`
    out.set(r.source_id, `${r.practice_tests.label}-${code}-Q${r.position}`)
  }
  return out
}

export type ZenSubject = 'all' | 'math' | 'rw'
export type ZenDifficulty = 'chill' | 'standard' | 'brutal'

/** Endless-stream pool for Zen mode: filter by subject + difficulty bucket.
 *  chill = easy (2), standard = everything, brutal = hard (4). Generated
 *  questions carry no difficulty (mapped to 3), so they land in standard. */
export function selectZen(
  bank: { generated: BankQuestion[]; harvested: BankQuestion[] },
  subject: ZenSubject,
  difficulty: ZenDifficulty,
): BankQuestion[] {
  let items = [...bank.generated, ...bank.harvested]
  if (subject !== 'all') items = items.filter((q) => q.section === subject)
  if (difficulty === 'chill') items = items.filter((q) => q.difficulty === 2)
  if (difficulty === 'brutal') items = items.filter((q) => q.difficulty === 4)
  return items
}

/** Skill-targeted drill pool: only questions whose archetype (skill slug) is
 *  in `skills`. Powers the Cramduck skill-map "practice" actions. */
export function selectBySkills(
  bank: { generated: BankQuestion[]; harvested: BankQuestion[] },
  skills: string[],
): BankQuestion[] {
  const set = new Set(skills)
  return [...bank.generated, ...bank.harvested].filter((q) => set.has(q.archetype))
}

/** Digital SAT domain blueprints (percent of each section's questions). */
const BLUEPRINT: Record<'rw' | 'math', Array<[string, number]>> = {
  rw: [
    ['Craft and Structure', 0.28],
    ['Information and Ideas', 0.26],
    ['Standard English Conventions', 0.26],
    ['Expression of Ideas', 0.2],
  ],
  math: [
    ['Algebra', 0.35],
    ['Advanced Math', 0.35],
    ['Problem-Solving and Data Analysis', 0.15],
    ['Geometry and Trigonometry', 0.15],
  ],
}
const SECTION_LENGTH: Record<'rw' | 'math', number> = { rw: 54, math: 44 } // both modules combined

function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Largest-remainder allocation of `total` items across weighted buckets. */
function allocate(total: number, weights: number[]): number[] {
  const raw = weights.map((w) => w * total)
  const floors = raw.map(Math.floor)
  let rem = total - floors.reduce((s, n) => s + n, 0)
  const order = raw
    .map((v, i) => [v - floors[i]!, i] as const)
    .sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (rem <= 0) break
    floors[i]! += 1
    rem -= 1
  }
  return floors
}

/** Sample `pool` down to the section's real-test domain ratio. */
function sampleByBlueprint(pool: BankQuestion[], section: 'rw' | 'math', cap = SECTION_LENGTH[section]): BankQuestion[] {
  const spec = BLUEPRINT[section]
  const total = Math.min(pool.length, cap)
  const quotas = allocate(total, spec.map(([, w]) => w))
  const byDomain = new Map<string, BankQuestion[]>()
  for (const q of shuffle(pool)) {
    const key = spec.some(([d]) => d === q.domain) ? q.domain : '_other'
    if (!byDomain.has(key)) byDomain.set(key, [])
    byDomain.get(key)!.push(q)
  }
  const picked: BankQuestion[] = []
  spec.forEach(([domain], i) => {
    picked.push(...(byDomain.get(domain) ?? []).slice(0, quotas[i]!))
  })
  // fill any shortfall from leftovers so small banks still build a full test
  if (picked.length < total) {
    const used = new Set(picked)
    picked.push(...shuffle(pool.filter((q) => !used.has(q))).slice(0, total - picked.length))
  }
  return shuffle(picked)
}

/** Archetype (skill-slug) counts for one source — the categorization view. */
export function archetypeCounts(
  bank: { generated: BankQuestion[]; harvested: BankQuestion[] },
  source: SourceKind,
  excludeBluebook: boolean,
  verifiedOnly = false,
): Array<{ archetype: string; count: number }> {
  const qs = selectQuestions(bank, source, excludeBluebook, verifiedOnly)
  const counts = new Map<string, number>()
  for (const q of qs) counts.set(q.archetype, (counts.get(q.archetype) ?? 0) + 1)
  return [...counts.entries()]
    .map(([archetype, count]) => ({ archetype, count }))
    .sort((a, b) => b.count - a.count || a.archetype.localeCompare(b.archetype))
}

export type TestFocus = 'math' | 'math-section' | 'rw' | 'rw-section'

// ---------------------------------------------------------------------------
// Pre-built adaptive practice tests (practice_tests / practice_test_questions,
// assembled offline by scripts/build-practice-tests.ts). Every test carries
// six modules: per section, module 1 (mixed) plus BOTH module-2 variants
// (easy + hard), so the sim can route on module-1 score like the real
// digital SAT. Series A = question_bank origin, series B = bluebook origin;
// a bank question appears in at most one test.
// ---------------------------------------------------------------------------

export type PracticeSeries = 'A' | 'B'

export interface PracticeTest {
  label: string
  series: PracticeSeries
  rw1: ExamModule
  rw2easy: ExamModule
  rw2hard: ExamModule
  math1: ExamModule
  math2easy: ExamModule
  math2hard: ExamModule
}

interface RawPracticeTestRow {
  id: number
  label: string
  series: PracticeSeries
}

interface RawPracticeQuestionRow {
  source_id: string
  section: 'reading-writing' | 'math'
  module: 1 | 2
  tier: 'mixed' | 'easy' | 'hard'
  position: number
}

/** Module code for a question display ID: RW1/RW2 (module 2 keeps the same
 *  code whether easy or hard — the route is shown separately). */
function moduleCode(section: 'reading-writing' | 'math', module: 1 | 2): string {
  const base = section === 'reading-writing' ? 'RW' : 'M'
  return `${base}${module}`
}

/** Load one pre-built practice test and shape it into ExamModules.
 *  Picks `label` when given, otherwise a random test of the series.
 *  Returns null when the series has no tests (caller falls back to random
 *  assembly). Questions come from the already-fetched bank. */
export async function fetchPracticeTest(
  bank: { generated: BankQuestion[]; harvested: BankQuestion[] },
  series: PracticeSeries,
  label?: string,
): Promise<PracticeTest | null> {
  const tests = (await fetchAllPages(
    `${SUPABASE_URL}/rest/v1/practice_tests?select=id,label,series&series=eq.${series}&order=label`,
  )) as RawPracticeTestRow[]
  if (tests.length === 0) return null
  const test = label ? tests.find((t) => t.label === label) : tests[Math.floor(Math.random() * tests.length)]
  if (!test) return null

  const rows = (await fetchAllPages(
    `${SUPABASE_URL}/rest/v1/practice_test_questions?select=source_id,section,module,tier,position&test_id=eq.${test.id}&order=position`,
  )) as RawPracticeQuestionRow[]

  const byId = new Map(bank.harvested.map((q) => [q.id, q]))
  const prefix = (list: BankQuestion[], moduleId: string): BankQuestion[] =>
    list.map((q) => ({ ...q, id: `${moduleId}-${q.id}` }))

  const makeModule = (section: 'reading-writing' | 'math', module: 1 | 2, tier: 'mixed' | 'easy' | 'hard'): ExamModule => {
    const rw = section === 'reading-writing'
    const secNo = rw ? 1 : 2
    const id = `${rw ? 'rw' : 'math'}${module}${module === 1 ? '' : tier === 'easy' ? 'e' : 'h'}`
    const code = moduleCode(section, module)
    const questions = rows
      .filter((r) => r.section === section && r.module === module && r.tier === tier)
      .map((r): BankQuestion | undefined => {
        const q = byId.get(r.source_id)
        return q ? { ...q, displayId: `${test.label}-${code}-Q${r.position}` } : undefined
      })
      .filter((q): q is BankQuestion => q !== undefined)
    return {
      id,
      label: `Section ${secNo}, Module ${module}`,
      title: rw ? 'Reading and Writing' : 'Math',
      minutes: rw ? 32 : 35,
      split: rw,
      difficultyTier: tier,
      questions: prefix(questions, id),
    }
  }

  return {
    label: test.label,
    series: test.series,
    rw1: makeModule('reading-writing', 1, 'mixed'),
    rw2easy: makeModule('reading-writing', 2, 'easy'),
    rw2hard: makeModule('reading-writing', 2, 'hard'),
    math1: makeModule('math', 1, 'mixed'),
    math2easy: makeModule('math', 2, 'easy'),
    math2hard: makeModule('math', 2, 'hard'),
  }
}

/** Labels of all pre-built practice tests per series (naturally sorted:
 *  A1, A2, … A10). Powers the start-screen test dropdowns. */
export async function fetchPracticeTestLabels(): Promise<{ A: string[]; B: string[] }> {
  const rows = (await fetchAllPages(
    `${SUPABASE_URL}/rest/v1/practice_tests?select=label,series`,
  )) as RawPracticeTestRow[]
  const nat = (a: string, b: string): number => {
    const na = Number(a.replace(/\D+/g, '')) || 0
    const nb = Number(b.replace(/\D+/g, '')) || 0
    return na - nb || a.localeCompare(b)
  }
  return {
    A: rows.filter((r) => r.series === 'A').map((r) => r.label).sort(nat),
    B: rows.filter((r) => r.series === 'B').map((r) => r.label).sort(nat),
  }
}

/** Module-1 score needed to route to the HARDER module 2 — the fixed
 *  thresholds used by Princeton Review's adaptive practice tests. */
export const MODULE2_HARD_THRESHOLD: Record<'rw' | 'math', number> = { rw: 15, math: 14 }

/** Resolve a practice-test display id (A2-RW2-Q20 / B3-M1-Q6) to the bank
 *  question's source_id. Module 2 easy/hard variants share display ids, so
 *  `tier` disambiguates. Returns the input unchanged when it is not a
 *  display id (e.g. a raw source_id) or no mapping exists. */
export async function resolveDisplayId(idOrDisplay: string, tier?: string): Promise<string> {
  const m = /^([AB]\d+)-(RW1|RW2|M1|M2)-Q(\d+)$/.exec(idOrDisplay)
  if (!m) return idOrDisplay
  const [, label, mod, qn] = m
  const section = mod!.startsWith('RW') ? 'reading-writing' : 'math'
  const module = mod!.endsWith('1') ? 1 : 2
  const tierParam = module === 2 && (tier === 'easy' || tier === 'hard') ? `&tier=eq.${tier}` : ''
  const rows = (await fetchAllPages(
    `${SUPABASE_URL}/rest/v1/practice_test_questions?select=source_id,practice_tests!inner(label)&practice_tests.label=eq.${label}&section=eq.${section}&module=eq.${module}&position=eq.${Number(qn)}${tierParam}`,
  )) as Array<{ source_id: string }>
  return rows[0]?.source_id ?? idOrDisplay
}

/** Build a 4-module digital-SAT-shaped test at real domain ratios.
 *  `focus` narrows the run to one module, or one full section. */
export function assembleTest(questions: BankQuestion[], focus?: TestFocus): ExamModule[] {
  const minutes = (count: number, realCount: number, realMinutes: number): number =>
    Math.max(5, Math.round((count / realCount) * realMinutes))
  const prefix = (list: BankQuestion[], module: string): BankQuestion[] =>
    list.map((q) => ({ ...q, id: `${module}-${q.id}` }))

  const sectionModules = (section: 'rw' | 'math'): ExamModule[] => {
    const pool = sampleByBlueprint(questions.filter((q) => q.section === section), section)
    const split = Math.ceil(pool.length / 2)
    const realCount = section === 'rw' ? 27 : 22
    const realMinutes = section === 'rw' ? 32 : 35
    const secNo = section === 'rw' ? 1 : 2
    const make = (id: string, from: number, to: number): ExamModule => ({
      id,
      label: `Section ${secNo}, Module ${id.slice(-1)}`,
      title: section === 'rw' ? 'Reading and Writing' : 'Math',
      minutes: minutes(to - from || 1, realCount, realMinutes),
      split: section === 'rw',
      questions: prefix(pool.slice(from, to), id),
    })
    const mods = [make(`${section}1`, 0, split), make(`${section}2`, split, pool.length)]
    return mods.filter((m) => m.questions.length > 0)
  }

  if (focus === 'rw') {
    const rw = sampleByBlueprint(questions.filter((q) => q.section === 'rw'), 'rw', 27)
    if (rw.length === 0) return []
    return [{ id: 'rw1', label: 'Section 1, Module 1', title: 'Reading and Writing', minutes: minutes(rw.length, 27, 32), split: true, questions: prefix(rw, 'rw1') }]
  }
  if (focus === 'math') {
    const math = sampleByBlueprint(questions.filter((q) => q.section === 'math'), 'math', 22)
    if (math.length === 0) return []
    return [{ id: 'math1', label: 'Section 2, Module 1', title: 'Math', minutes: minutes(math.length, 22, 35), split: false, questions: prefix(math, 'math1') }]
  }
  if (focus === 'rw-section') return sectionModules('rw')
  if (focus === 'math-section') return sectionModules('math')

  return [...sectionModules('rw'), ...sectionModules('math')]
}

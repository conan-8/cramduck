export interface DiagramSpec {
  kind?: 'triangle' | 'parabola' | 'barchart'
  caption?: string
  /** Real parameterized figure: rendered by the Cramduck SVG renderer
   *  bundle (public/renderers.js, window.CramduckRenderers). When present
   *  it replaces the placeholder glyph. */
  live?: {
    archetypeId: string
    parameters: Record<string, unknown>
  }
}

export interface TableSpec {
  caption?: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export interface Question {
  id: string
  skill: string
  prompt: string
  passageHeading?: string
  /** Stimulus text. Wrap a sentence in [[double brackets]] to render it underlined. */
  passage?: string
  /** Table stimulus (rendered above the prompt). */
  table?: TableSpec
  /** Multiple-choice options. Omit for student-produced (grid-in) responses. */
  options?: string[]
  /** Correct option letter ('A'-'D') or numeric string for grid-in. */
  correct: string
  /** Explanation shown after checking an answer (zen mode). */
  rationale?: string
  diagram?: DiagramSpec
  /** Rendered question image (harvested math items carry the whole question
   *  as a picture — College Board draws equations as vector art). */
  imageAsset?: string
  /** Archetype (canonical skill slug) this question belongs to. */
  archetype?: string
  /** Practice-test display ID — `${testLabel}-${RW1|RW2|M1|M2}-Q${position}`
   *  (e.g. A2-RW2-Q20). Pre-built adaptive tests only; undefined on random
   *  runs. Shown on the mistakes/saved page and score breakdowns. */
  displayId?: string
}

export interface ExamModule {
  id: string
  label: string
  title: string
  minutes: number
  /** Two-pane passage | question layout (Reading & Writing) vs single column (Math). */
  split: boolean
  /** Adaptive tier — module 1 is 'mixed'; module 2 comes in 'easy' and
   *  'hard' variants, routed by module-1 score (pre-built practice tests). */
  difficultyTier?: 'mixed' | 'easy' | 'hard'
  questions: Question[]
}

import { useRef, useState } from 'react'
import { Bookmark, ChevronsLeftRight } from 'lucide-react'
import type { ExamModule, Question, TableSpec } from '../types/exam'
import AnswerOptions from './AnswerOptions'
import DiagramPlaceholder from './DiagramPlaceholder'
import RichText from './RichText'

/** Table stimulus (two-way frequency tables, data tables). Exported for the
 *  read-only breakdown view. */
export function TableFigure({ table }: { table: TableSpec }) {
  return (
    <figure className="mx-auto my-6 w-full max-w-[520px] overflow-hidden rounded-lg border border-[#b9bec9] bg-white px-5 py-4">
      {table.caption && (
        <figcaption className="mb-2 text-center font-exam-serif text-sm text-[#3c4048]">{table.caption}</figcaption>
      )}
      <table className="w-full border-collapse font-exam-serif text-[15px] text-[#1c1c1e]">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} className="border border-[#b9bec9] bg-[#f1f2f6] px-3 py-1.5 text-center font-semibold">
                <RichText text={String(c)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-[#d6d9de] px-3 py-1.5 text-center">
                  <RichText text={String(cell)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Small ⇕ handle rendered on the divider between split panes. */
function DividerHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="relative hidden w-[5px] shrink-0 cursor-col-resize bg-[#d6d9de] md:block"
    >
      <span className="absolute left-1/2 top-1/2 flex h-8 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] bg-[#1c1c1e] text-white">
        <ChevronsLeftRight size={15} />
      </span>
    </div>
  )
}

/** Blue square badge (top-right of the question header) that toggles the
 *  per-option cross-out buttons. */
function StrikeBadge({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      title="Answer eliminator"
      className={`flex h-9 w-10 items-center justify-center rounded-md border text-[12px] font-bold tracking-tight ${
        active ? 'border-[#3b4ed8] bg-[#3b4ed8] text-white' : 'border-[#9aa1ad] bg-white text-[#5b616e]'
      }`}
    >
      <span className="relative px-0.5">
        ABC
        <span className="absolute -inset-y-0.5 left-0 right-0">
          <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 -rotate-12 border-t-2 border-current" />
        </span>
      </span>
    </button>
  )
}

interface HeaderProps {
  number: number
  flagged: boolean
  hasOptions: boolean
  strikesVisible: boolean
  hideFlag?: boolean
  onToggleFlag: () => void
  onToggleStrikes: () => void
}

function QuestionHeader({ number, flagged, hasOptions, strikesVisible, hideFlag, onToggleFlag, onToggleStrikes, archetype }: HeaderProps & { archetype?: string }) {
  return (
    <div className="flex items-center justify-between border-b-2 border-dashed border-[#c6c9d2] pb-2.5">
      <div className="flex items-center gap-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#1c1c1e] text-[16px] font-bold text-white">
          {number}
        </span>
        {!hideFlag && (
          <button
            onClick={onToggleFlag}
            aria-pressed={flagged}
            className={`flex items-center gap-1.5 text-[15px] font-semibold ${
              flagged ? 'text-[#c62828] underline underline-offset-4' : 'text-[#3c4048] hover:text-[#1c1c1e]'
            }`}
          >
            <Bookmark size={19} className={flagged ? 'fill-[#c62828] text-[#c62828]' : ''} />
            Mark for Review
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {archetype && (
          <span className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[#8a8f99]">{archetype}</span>
        )}
        {hasOptions && <StrikeBadge active={strikesVisible} onToggle={onToggleStrikes} />}
      </div>
    </div>
  )
}

/** Rendered preview of a grid-in entry: fractions stack vertically. */
function AnswerPreview({ value }: { value: string }) {
  const trimmed = value.trim()
  const frac = trimmed.match(/^(-?\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/)
  return (
    <div className="mt-7 flex items-center gap-3">
      <span className="font-exam-serif text-lg font-bold text-[#1c1c1e]">Answer Preview:</span>
      {trimmed === '' ? null : frac ? (
        <span className="inline-flex flex-col items-center font-exam-serif text-lg leading-tight text-[#1c1c1e]">
          <span className="border-b-2 border-[#1c1c1e] px-1.5">{frac[1]}</span>
          <span className="px-1.5">{frac[2]}</span>
        </span>
      ) : (
        <span className="font-exam-serif text-[20px] italic text-[#1c1c1e]">{trimmed}</span>
      )}
    </div>
  )
}

const SPR_RULES: string[] = [
  'If you find more than one correct answer, enter only one of them.',
  'A positive answer can be up to 5 characters; a negative answer can be up to 6 characters, including the minus sign.',
  'If a fraction is too long to fit in the entry box, enter its decimal equivalent instead.',
  'If a decimal is too long, truncate it or round it at the fourth digit.',
  'Enter a mixed number such as 3½ as an improper fraction (7/2) or as its decimal equivalent (3.5).',
  'Leave out symbols such as percent signs, commas, and dollar signs.',
]

const SPR_EXAMPLES: Array<{ answer: string; ok: string[]; bad: string[] }> = [
  { answer: '3.5', ok: ['3.5', '3.50', '7/2'], bad: ['31/2', '3 1/2'] },
  { answer: '2/3', ok: ['2/3', '.6666', '.6667', '0.666', '0.667'], bad: ['0.66', '.66', '0.67', '.67'] },
  { answer: '−1/3', ok: ['−1/3', '−.3333', '−0.333'], bad: ['−.33', '−0.33'] },
]

/** Left pane shown beside student-produced response questions. */
function SprDirectionsPane() {
  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h2 className="font-exam-serif text-[24px] font-bold text-[#1c1c1e]">Student-produced response directions</h2>
      <ul className="mt-5 list-disc space-y-3.5 pl-6 font-exam-serif text-[17px] leading-[1.65] text-[#1c1c1e]">
        {SPR_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <p className="mt-8 text-center font-exam-serif text-[18px] text-[#1c1c1e]">Examples</p>
      <table className="mt-3 w-full border-collapse font-exam-serif text-[16px]">
        <thead>
          <tr>
            <th className="border border-[#b9bec9] px-4 py-3 text-center font-semibold">Answer</th>
            <th className="border border-[#b9bec9] px-4 py-3 text-center font-semibold">Acceptable ways to enter answer</th>
            <th className="border border-[#b9bec9] px-4 py-3 text-center font-semibold">
              Unacceptable: will NOT receive credit
            </th>
          </tr>
        </thead>
        <tbody>
          {SPR_EXAMPLES.map((row) => (
            <tr key={row.answer}>
              <td className="border border-[#b9bec9] px-4 py-3 text-center">{row.answer}</td>
              <td className="border border-[#b9bec9] px-4 py-3">
                <div className="flex flex-col items-center gap-1.5">
                  {row.ok.map((v) => (
                    <code key={v} className="rounded bg-[#f1f2f6] px-1.5 py-0.5 font-mono text-[13px]">
                      {v}
                    </code>
                  ))}
                </div>
              </td>
              <td className="border border-[#b9bec9] px-4 py-3">
                <div className="flex flex-col items-center gap-1.5">
                  {row.bad.map((v) => (
                    <code key={v} className="rounded bg-[#f1f2f6] px-1.5 py-0.5 font-mono text-[13px]">
                      {v}
                    </code>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface QuestionViewProps {
  module: ExamModule
  question: Question
  number: number
  answer: string | undefined
  flagged: boolean
  crossed: string[]
  onAnswer: (questionId: string, value: string) => void
  onToggleFlag: (questionId: string) => void
  onToggleCross: (questionId: string, letter: string) => void
  /** Zen: lock options + color correct/wrong after checking. */
  reveal?: boolean
  /** Zen: hide the Mark for Review control. */
  hideFlag?: boolean
}

export default function QuestionView({
  module,
  question,
  number,
  answer,
  flagged,
  crossed,
  onAnswer,
  onToggleFlag,
  onToggleCross,
  reveal,
  hideFlag,
}: QuestionViewProps) {
  const [strikesVisible, setStrikesVisible] = useState(true)
  const [splitPct, setSplitPct] = useState(50)
  const splitRef = useRef<HTMLDivElement>(null)

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect) return
      setSplitPct(Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const header = (
    <QuestionHeader
      number={number}
      flagged={flagged}
      hasOptions={!!question.options}
      strikesVisible={strikesVisible}
      hideFlag={hideFlag}
      onToggleFlag={() => onToggleFlag(question.id)}
      onToggleStrikes={() => setStrikesVisible((v) => !v)}
      archetype={question.archetype}
    />
  )

  const promptBlock = (
    <RichText
      text={question.prompt}
      className="mt-5 block whitespace-pre-line font-exam-serif text-[17px] font-medium leading-[1.7] text-[#1c1c1e]"
    />
  )

  const answerBlock = question.options ? (
    <div className="mt-6">
      <AnswerOptions
        options={question.options}
        selected={answer}
        crossed={crossed}
        showStrikeButtons={strikesVisible}
        onSelect={(letter) => onAnswer(question.id, letter)}
        onToggleCross={(letter) => onToggleCross(question.id, letter)}
        reveal={reveal}
        correctLetter={question.correct}
      />
    </div>
  ) : (
    <div className="mt-6">
      <input
        id={`gridin-${question.id}`}
        value={answer ?? ''}
        onChange={(e) => onAnswer(question.id, e.target.value.replace(/[^0-9.\-/]/g, '').slice(0, 6))}
        inputMode="text"
        autoComplete="off"
        readOnly={reveal}
        aria-label="Enter your answer"
        className={`w-52 rounded-md border px-4 py-2 text-center font-exam-serif text-2xl tracking-[0.25em] outline-none ${
          reveal
            ? 'border-[#2e7d32] bg-[#e8f5e9] text-[#1b5e20]'
            : 'border-[#6d7380] bg-white text-[#1c1c1e] focus:border-[#3b4ed8] focus:ring-2 focus:ring-[#3b4ed8]/20'
        }`}
      />
      <AnswerPreview value={answer ?? ''} />
      {reveal && (
        <p className="mt-3 font-exam-serif text-[16px] font-semibold text-[#1b5e20]">
          Correct answer: {question.correct}
        </p>
      )}
    </div>
  )

  // Reading & Writing: passage left, question right.
  if (module.split) {
    return (
      <div
        ref={splitRef}
        className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden"
        style={{ '--split-pct': `${splitPct}%` } as React.CSSProperties}
      >
        <div className="flex-1 px-8 py-8 md:w-[var(--split-pct)] md:flex-none md:overflow-y-auto">
          {question.passageHeading && (
            <RichText
              text={question.passageHeading}
              className="mb-3 block font-exam-serif text-[17px] leading-[1.7] text-[#1c1c1e]"
            />
          )}
          {question.imageAsset && <DiagramPlaceholder image={question.imageAsset} />}
          {question.table && <TableFigure table={question.table} />}
          {question.passage && (
            <RichText
              text={question.passage}
              className="block whitespace-pre-line font-exam-serif text-[17px] leading-[1.8] text-[#1c1c1e]"
            />
          )}
        </div>
        <DividerHandle onPointerDown={startDrag} />
        <div className="flex-1 px-8 py-8 md:overflow-y-auto">
          {header}
          {question.table && <TableFigure table={question.table} />}
          {promptBlock}
          {answerBlock}
        </div>
      </div>
    )
  }

  // Math student-produced response: directions left, question right.
  if (!question.options) {
    return (
      <div className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex-1 md:overflow-y-auto">
          <SprDirectionsPane />
        </div>
        <DividerHandle onPointerDown={startDrag} />
        <div className="flex-1 px-8 py-8 md:overflow-y-auto">
          {header}
          {question.imageAsset && <DiagramPlaceholder image={question.imageAsset} />}
          {question.table && <TableFigure table={question.table} />}
          {promptBlock}
          {answerBlock}
        </div>
      </div>
    )
  }

  // Math multiple choice: single column.
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[780px] px-6 py-8">
        {header}
        {question.imageAsset && <DiagramPlaceholder image={question.imageAsset} />}
        {question.diagram && <DiagramPlaceholder diagram={question.diagram} />}
        {question.table && <TableFigure table={question.table} />}
        {promptBlock}
        {answerBlock}
      </div>
    </div>
  )
}

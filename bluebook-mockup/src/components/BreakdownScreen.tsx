import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { isCorrect } from '../data/live'
import RichText from './RichText'
import { TableFigure } from './QuestionView'
import { consumeBreakdown, readBreakdown, type BreakdownPayload, type BreakdownQuestion } from '../lib/breakdown'

/**
 * Score breakdown — opened in a NEW BROWSER TAB from the results screen,
 * one per module. Lists every question by its practice-test ID
 * (e.g. A2-RW2-Q20) with a subtle status fill: green = correct,
 * yellow = skipped, red = wrong. Clicking a row expands the full question
 * with your answer, the correct answer, the rationale, and an
 * "Ask CramduckAI" button (placeholder — wired up later).
 *
 * Data handoff: ResultsScreen writes the module payload to localStorage
 * under a one-time key and opens `#/breakdown?key=...`; this screen reads
 * the payload and removes the key (see lib/breakdown.ts).
 */

function statusOf(q: BreakdownQuestion): 'correct' | 'skipped' | 'wrong' {
  const a = q.answer
  if (a === undefined || a.trim() === '') return 'skipped'
  return isCorrect(q.question, a) ? 'correct' : 'wrong'
}

const ROW_STYLE: Record<string, string> = {
  correct: 'bg-[#e9f5ea] hover:bg-[#dff0e1]',
  skipped: 'bg-[#fdf6dd] hover:bg-[#fbf1cf]',
  wrong: 'bg-[#fbeaea] hover:bg-[#f8dede]',
}
const DOT_STYLE: Record<string, string> = {
  correct: 'bg-[#2e7d32]',
  skipped: 'bg-[#b58900]',
  wrong: 'bg-[#c62828]',
}
const TAG_STYLE: Record<string, string> = {
  correct: 'text-[#1b5e20]',
  skipped: 'text-[#8d6e00]',
  wrong: 'text-[#b71c1c]',
}

function ExpandedQuestion({ q, status }: { q: BreakdownQuestion; status: 'correct' | 'skipped' | 'wrong' }) {
  const { question, answer } = q
  const optionText = (letter: string) => {
    const i = letter.charCodeAt(0) - 65
    return question.options?.[i]
  }
  return (
    <div className="border-t border-[#e4e6ea] bg-white px-5 py-4">
      {question.passage && (
        <div className="mb-3 max-h-56 overflow-auto rounded-lg bg-[#f6f7fa] px-4 py-3">
          <RichText
            text={question.passage}
            className="block font-exam-serif text-[14px] leading-[1.6] text-[#1c1c1e]"
          />
        </div>
      )}
      <RichText
        text={question.prompt}
        className="block font-exam-serif text-[15px] leading-[1.6] text-[#1c1c1e]"
      />
      {question.table && <TableFigure table={question.table} />}
      {question.imageAsset && (
        <img
          src={question.imageAsset}
          alt=""
          className="mx-auto my-3 max-h-[320px] rounded-lg border border-[#e4e6ea] bg-white"
        />
      )}
      {question.options && (
        <ul className="mt-3 space-y-1.5">
          {question.options.map((text, i) => {
            const letter = String.fromCharCode(65 + i)
            const isYours = answer === letter
            const isRight = question.correct === letter
            return (
              <li
                key={letter}
                className={`rounded-md border px-3 py-1.5 text-[14px] ${
                  isRight
                    ? 'border-[#2e7d32] bg-[#e9f5ea] font-semibold text-[#1b5e20]'
                    : isYours
                      ? 'border-[#c62828] bg-[#fbeaea] text-[#b71c1c]'
                      : 'border-[#e4e6ea] text-[#3c4048]'
                }`}
              >
                {letter}. <RichText text={text} className="inline font-exam-serif" />
                {isRight && <span className="ml-2 text-[11px] font-bold uppercase tracking-wide">correct</span>}
                {isYours && !isRight && (
                  <span className="ml-2 text-[11px] font-bold uppercase tracking-wide">your answer</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!question.options && (
        <p className="mt-3 text-[14px]">
          Your answer: <b className={status === 'correct' ? 'text-[#1b5e20]' : 'text-[#b71c1c]'}>{answer ?? '—'}</b>
          {' · '}Correct: <b className="text-[#1b5e20]">{question.correct}</b>
        </p>
      )}
      {question.options && answer !== undefined && answer !== '' && (
        <p className="mt-2 text-[13px] text-[#5b616e]">
          Your answer: <b>{answer}</b>
          {optionText(answer) ? ` — ${optionText(answer)}` : ''}
        </p>
      )}
      {question.rationale && (
        <div className="mt-3 rounded-lg bg-[#f4f6fa] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[#8a8f99]">Why</p>
          <RichText
            text={question.rationale}
            className="mt-1 block font-exam-serif text-[14px] leading-[1.65] text-[#1c1c1e]"
          />
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled
          title="Ask CramduckAI — coming soon"
          className="cursor-not-allowed rounded-full border border-[#d6d9de] bg-[#f4f5f7] px-5 py-2 text-[13px] font-bold text-[#9aa1ad]"
        >
          Ask CramduckAI
        </button>
        <span className="text-[11px] uppercase tracking-wide text-[#8a8f99]">coming soon</span>
      </div>
    </div>
  )
}

export default function BreakdownScreen() {
  const [searchParams] = useSearchParams()
  const key = searchParams.get('key')
  // read once during the initial render (pure — see lib/breakdown), then
  // consume the storage key after mount so a reload shows the expired note
  const [payload] = useState<BreakdownPayload | null>(() => readBreakdown(key))
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    consumeBreakdown(key)
  }, [key])

  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] p-6">
        <p className="max-w-sm text-center text-sm text-[#5b616e]">
          This breakdown link has expired — open it again from the results screen of a finished test.
        </p>
      </div>
    )
  }

  const counts = { correct: 0, skipped: 0, wrong: 0 }
  for (const q of payload.questions) counts[statusOf(q)]++
  const route =
    payload.tier === 'easy'
      ? 'Routed to the easier Module 2'
      : payload.tier === 'hard'
        ? 'Routed to the harder Module 2'
        : ''

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1c1c1e]">
      <header className="border-b border-[#d6d9de] bg-white px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[1.4px] text-[#8a8f99]">
            Score breakdown{payload.testLabel ? ` · ${payload.testLabel}` : ''}
          </p>
          <h1 className="mt-1 text-[22px] font-bold">
            {payload.moduleLabel} · {payload.title}
          </h1>
          <p className="mt-1 text-[13px] text-[#5b616e]">
            {counts.correct} correct · {counts.wrong} wrong · {counts.skipped} skipped
            {route ? ` · ${route}` : ''}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="overflow-hidden rounded-2xl border border-[#d6d9de] bg-white shadow-sm">
          {payload.questions.map((q) => {
            const status = statusOf(q)
            const isOpen = expanded === q.displayId
            return (
              <div key={q.displayId} className="border-b border-[#e4e6ea] last:border-b-0">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : q.displayId)}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${ROW_STYLE[status]}`}
                >
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_STYLE[status]}`} />
                  <span className="font-mono text-[14px] font-bold tracking-wide">{q.displayId}</span>
                  <span className={`ml-auto text-[11px] font-bold uppercase tracking-[1.2px] ${TAG_STYLE[status]}`}>
                    {status}
                  </span>
                  <span aria-hidden="true" className="text-[12px] text-[#8a8f99]">
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>
                {isOpen && <ExpandedQuestion q={q} status={status} />}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}

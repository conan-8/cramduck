import { useMemo } from 'react'
import type { ExamModule, Question } from '../types/exam'
import { isCorrect } from '../data/live'
import RichText from './RichText'
import { openBreakdown } from '../lib/breakdown'

const CONFETTI_COLORS = ['#f7d54d', '#f48fb1', '#80deea', '#ffffff', '#ffcc80']

interface ResultsScreenProps {
  test: ExamModule[]
  answers: Record<string, string>
  /** Pre-built practice test label (A2, B3, …) — absent on random runs. */
  testLabel?: string
  /** Per-question dwell times in ms, keyed by question id (Home's tracking). */
  times?: Record<string, number>
  onExit: () => void
}

/** One reviewed question: badge, prompt, your answer vs correct, rationale. */
function QuestionReview({ q, number, answer }: { q: Question; number: number; answer: string | undefined }) {
  const answered = answer !== undefined && answer.trim() !== ''
  const right = answered ? isCorrect(q, answer) : false
  const optionText = (letter: string) => {
    const i = letter.charCodeAt(0) - 65
    return q.options?.[i]
  }

  return (
    <div className="flex items-start gap-4 border-b border-[#eef0f4] px-6 py-5 last:border-b-0">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white ${
          !answered ? 'bg-[#9aa1ad]' : right ? 'bg-[#2e7d32]' : 'bg-[#c62828]'
        }`}
      >
        {!answered ? '–' : right ? '✓' : '✗'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[#8a8f99]">
          {number}
          {q.displayId ? ` · ${q.displayId}` : ''} · {q.skill}
        </p>
        <RichText
          text={q.prompt}
          className="mt-1 block font-exam-serif text-[15px] leading-[1.6] text-[#1c1c1e]"
        />
        <p className="mt-1.5 text-[13px] text-[#5b616e]">
          {!answered ? (
            'Skipped — no answer.'
          ) : (
            <>
              Your answer:{' '}
              <b className={right ? 'text-[#1b5e20]' : 'text-[#b71c1c]'}>
                {q.options ? `${answer}${optionText(answer) ? ` — ${optionText(answer)}` : ''}` : answer}
              </b>
            </>
          )}
          {!right && (
            <>
              {' '}
              · Correct: <b className="text-[#1b5e20]">{q.correct}</b>
            </>
          )}
        </p>
        {q.rationale ? (
          <div className="mt-2.5 rounded-lg bg-[#f4f6fa] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[#8a8f99]">Why</p>
            <RichText
              text={q.rationale}
              className="mt-1 block font-exam-serif text-[14px] leading-[1.65] text-[#1c1c1e]"
            />
          </div>
        ) : (
          <p className="mt-2 font-exam-serif text-[14px] italic text-[#8a8f99]">No rationale for this one yet.</p>
        )}
      </div>
    </div>
  )
}

export default function ResultsScreen({ test, answers, testLabel, times, onExit }: ResultsScreenProps) {
  const confetti = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: (i * 37 + 13) % 100,
        top: (i * 23 + 7) % 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: (i * 53) % 360,
        delay: (i % 7) * 0.4,
        wide: i % 3 === 0,
      })),
    [],
  )

  const total = test.reduce((n, m) => n + m.questions.length, 0)
  const answered = test.reduce(
    (n, m) => n + m.questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length,
    0,
  )
  const correct = test.reduce(
    (n, m) =>
      n +
      m.questions.filter((q) => {
        const a = answers[q.id]
        return a !== undefined && a.trim() !== '' && isCorrect(q, a)
      }).length,
    0,
  )
  const pct = answered > 0 ? Math.round((correct / answered) * 100) : 0

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#1e2350] text-white">
      {/* Confetti */}
      {confetti.map((c, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute rounded-[1px] opacity-90"
          style={
            {
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: c.wide ? 10 : 6,
              height: c.wide ? 4 : 10,
              backgroundColor: c.color,
              '--bb-rot': `${c.rot}deg`,
              transform: `rotate(${c.rot}deg)`,
              animation: `bb-float 3.2s ease-in-out ${c.delay}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}

      <header className="relative z-10 flex items-center justify-between bg-white px-6 py-3 text-[#1c1c1e]">
        <p className="text-sm font-bold">Bluebook Practice Exams</p>
        <button onClick={onExit} className="text-sm font-semibold text-[#1c1c1e] hover:text-[#3b4ed8]">
          Return to Home
        </button>
      </header>

      <main className="relative z-10 flex flex-col items-center px-6 py-12">
        <h1 className="text-[34px] font-bold">You're All Finished!</h1>
        {testLabel && (
          <p className="mt-2 rounded-full border border-[#4a5170] px-4 py-1 font-mono text-[12px] font-bold uppercase tracking-[1.4px] text-[#f7d54d]">
            Test {testLabel}
          </p>
        )}

        <div className="mt-8 grid w-full max-w-2xl grid-cols-3 gap-4 rounded-2xl bg-white p-6 text-center text-[#1c1c1e]">
          <div>
            <p className="text-[34px] font-bold leading-none">{pct}%</p>
            <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-[#8a8f99]">accuracy</p>
          </div>
          <div>
            <p className="text-[34px] font-bold leading-none">
              {correct}<span className="text-[18px] text-[#8a8f99]">/{answered}</span>
            </p>
            <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-[#8a8f99]">correct</p>
          </div>
          <div>
            <p className="text-[34px] font-bold leading-none">{total - answered}</p>
            <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-[#8a8f99]">unanswered</p>
          </div>
        </div>

        <button
          onClick={onExit}
          className="mt-10 rounded-full bg-[#f7d54d] px-10 py-3.5 text-[15px] font-bold text-[#1c1c1e] hover:bg-[#efc93a]"
        >
          Restart Practice Test
        </button>

        {/* Question-by-question review with rationales */}
        <section className="mt-12 w-full max-w-3xl" aria-label="Question review">
          <h2 className="text-center text-[22px] font-bold">Answer key &amp; explanations</h2>
          {test.map((m) => {
            const moduleCorrect = m.questions.filter((q) => {
              const a = answers[q.id]
              return a !== undefined && a.trim() !== '' && isCorrect(q, a)
            }).length
            const route =
              m.difficultyTier === 'easy'
                ? ' · routed to the easier Module 2'
                : m.difficultyTier === 'hard'
                  ? ' · routed to the harder Module 2'
                  : ''
            const openModuleBreakdown = () =>
              openBreakdown({
                testLabel,
                moduleLabel: m.label,
                title: m.title,
                tier: m.difficultyTier,
                minutes: m.minutes,
                questions: m.questions.map((q, i) => ({
                  displayId: q.displayId ?? `Q${i + 1}`,
                  question: q,
                  answer: answers[q.id],
                  timeMs: times?.[q.id],
                })),
              })
            return (
            <div key={m.id} className="mt-8">
              <p className="mb-3 text-center text-[12px] font-semibold uppercase tracking-[1.4px] text-[#c9cede]">
                {m.label} · {m.title} · {moduleCorrect}/{m.questions.length} correct{route}
              </p>
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={openModuleBreakdown}
                  className="rounded-full border border-[#4a5170] px-5 py-2 text-[12px] font-bold uppercase tracking-[1.2px] text-white hover:border-[#f7d54d] hover:text-[#f7d54d]"
                >
                  Open breakdown ↗
                </button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[#d6d9de] bg-white text-[#1c1c1e] shadow-sm">
                {m.questions.map((q, i) => (
                  <QuestionReview key={q.id} q={q} number={i + 1} answer={answers[q.id]} />
                ))}
              </div>
            </div>
            )
          })}
          {total === 0 && (
            <p className="mt-6 text-center text-sm text-[#c9cede]">No questions in this run.</p>
          )}
        </section>
      </main>
    </div>
  )
}

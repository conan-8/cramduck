import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { fetchBank, fetchDisplayIds, fetchSessionEvents, isCorrect } from '../data/live'
import { buildQuestionContext } from '../lib/ask-ai'
import AskAiSidebar from './AskAiSidebar'
import RichText from './RichText'
import { TableFigure } from './QuestionView'
import { consumeBreakdown, readBreakdown, type BreakdownPayload, type BreakdownQuestion } from '../lib/breakdown'

/**
 * Score breakdown — opened in a NEW BROWSER TAB from the results screen,
 * one per module, or from the hub's simulator tab for any past session.
 * Lists every question by its practice-test ID (e.g. A2-RW2-Q20) with a
 * status fill (green = correct, amber = skipped, red = wrong) and the
 * per-question dwell time. Clicking a row expands the full question with
 * your answer, the correct answer, the rationale, and an "Ask CramduckAI"
 * button that opens the coach sidebar seeded with that question.
 *
 * Styled in the Cramduck hub's design language (see the `.cdk` block in
 * index.css): paper/sheet surfaces, hard shadows, washi tape, Space Mono
 * micro-labels — and it inherits the hub's light/dark/blueprint theme via
 * the shared `cramduck_mode` localStorage key (same origin).
 *
 * Two entry points:
 *  - `#/breakdown?key=...` — one-time localStorage handoff written by the
 *    results screen of a just-finished test (see lib/breakdown.ts).
 *  - `#/breakdown?start=...&end=...` — PAST SESSION mode. Rebuilds the run
 *    from student_events + the live question bank, so it works for any
 *    recorded session, not just the current one.
 */

const SESSION_MODE_TITLE: Record<string, string> = {
  exam: 'Timed run',
  practice: 'Zen mode',
  diagnostic: 'Diagnostic run',
}

/** Build a breakdown payload from the recorded events of one past session. */
async function buildSessionPayload(start: string, end: string, mode: string | null, label: string | null): Promise<BreakdownPayload> {
  const [events, bank] = await Promise.all([fetchSessionEvents(start, end), fetchBank()])
  const byId = new Map([...bank.generated, ...bank.harvested].map((q) => [q.id, q]))
  const displayIds = await fetchDisplayIds([...new Set(events.map((e) => e.question_id))])
  const questions: BreakdownQuestion[] = []
  for (const e of events) {
    const q = byId.get(e.question_id)
    if (!q) continue
    questions.push({
      displayId: displayIds.get(e.question_id) ?? `Q${questions.length + 1}`,
      question: q,
      answer: (e.choice_id ?? e.grid_in_answer ?? '').trim() || undefined,
      timeMs: e.time_ms,
    })
  }
  const when = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return {
    testLabel: label || undefined,
    moduleLabel: SESSION_MODE_TITLE[mode ?? ''] ?? 'Session',
    title: when,
    questions,
  }
}

type Status = 'correct' | 'skipped' | 'wrong'

function statusOf(q: BreakdownQuestion): Status {
  const a = q.answer
  if (a === undefined || a.trim() === '') return 'skipped'
  return isCorrect(q.question, a) ? 'correct' : 'wrong'
}

/** Status → cdk class suffix: correct=ok, wrong=no, skipped=sk. */
const SFX: Record<Status, string> = { correct: 'ok', wrong: 'no', skipped: 'sk' }

/** Compact per-question dwell time: "45s", "1m 23s" — null when untracked. */
function fmtTime(ms?: number): string | null {
  if (ms === undefined || ms <= 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

/** The hub's theme (light/dark/blueprint), read once — same origin, same key. */
function hubMode(): string {
  try {
    return localStorage.getItem('cramduck_mode') || 'light'
  } catch {
    return 'light'
  }
}

function ExpandedQuestion({ q, status, onAsk }: { q: BreakdownQuestion; status: Status; onAsk: () => void }) {
  const { question, answer } = q
  const time = fmtTime(q.timeMs)
  return (
    <div className="cdk-open">
      {question.passage && (
        <div className="cdk-passage">
          <RichText text={question.passage} className="block font-exam-serif text-[14px] leading-[1.7]" />
        </div>
      )}
      <RichText text={question.prompt} className="block font-exam-serif text-[15px] leading-[28px]" />
      {question.table && <TableFigure table={question.table} />}
      {question.imageAsset && (
        <img
          src={question.imageAsset}
          alt=""
          className="mx-auto my-7 max-h-[320px] rounded-[3px] border-[1.5px] border-[var(--line)] bg-white"
        />
      )}
      {question.options && (
        <ul className="cdk-opts">
          {question.options.map((text, i) => {
            const letter = String.fromCharCode(65 + i)
            const isYours = answer === letter
            const isRight = question.correct === letter
            return (
              <li key={letter} className={`cdk-opt${isRight ? ' ok' : isYours ? ' no' : ''}`}>
                {letter}. <RichText text={text} className="inline font-exam-serif" />
                {isRight && <span className="cdk-opt-tag">correct</span>}
                {isYours && !isRight && <span className="cdk-opt-tag">your answer</span>}
              </li>
            )
          })}
        </ul>
      )}
      {!question.options && (
        <p className="cdk-meta">
          YOUR ANSWER <b className={status === 'correct' ? 'ok' : 'no'}>{answer ?? '—'}</b>
          {' · '}CORRECT <b className="ok">{question.correct}</b>
        </p>
      )}
      {question.options && answer !== undefined && answer !== '' && (
        <p className="cdk-meta">
          YOUR ANSWER <b>{answer}</b>
        </p>
      )}
      {time && (
        <p className="cdk-meta">
          TIME ON QUESTION <b>{time}</b>
        </p>
      )}
      {question.rationale && (
        <div className="cdk-why">
          <p className="t">Why</p>
          <RichText text={question.rationale} className="mt-1.5 block font-exam-serif text-[14px] leading-[1.7]" />
        </div>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button type="button" onClick={onAsk} className="cdk-btn">
          Ask CramduckAI
        </button>
      </div>
    </div>
  )
}

export default function BreakdownScreen() {
  const [searchParams] = useSearchParams()
  const key = searchParams.get('key')
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  // read once during the initial render (pure — see lib/breakdown), then
  // consume the storage key after mount so a reload shows the expired note
  const [keyedPayload] = useState<BreakdownPayload | null>(() => readBreakdown(key))
  const [sessionPayload, setSessionPayload] = useState<BreakdownPayload | null>(null)
  const [sessionError, setSessionError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  /** Question the "Ask CramduckAI" sidebar is currently seeded with. */
  const [askFor, setAskFor] = useState<BreakdownQuestion | null>(null)
  const [mode] = useState<string>(hubMode)

  useEffect(() => {
    consumeBreakdown(key)
  }, [key])

  // Past-session mode: rebuild the run from student_events + the bank.
  useEffect(() => {
    if (key || !start || !end) return
    let cancelled = false
    buildSessionPayload(start, end, searchParams.get('mode'), searchParams.get('label'))
      .then((p) => {
        if (!cancelled) {
          setSessionPayload(p)
          setSessionError(false)
        }
      })
      .catch(() => !cancelled && setSessionError(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, start, end])

  const payload = keyedPayload ?? sessionPayload

  if (!payload) {
    return (
      <div className="cdk" data-mode={mode}>
        <div className="cdk-wrap flex min-h-screen items-center">
          <p className="cdk-note-card">
            {start && end
              ? sessionError
                ? 'Couldn’t load this session’s breakdown — make sure you’re signed in with the account that ran it.'
                : 'Loading breakdown…'
              : 'This breakdown link has expired — open it again from the results screen of a finished test.'}
          </p>
        </div>
      </div>
    )
  }

  const counts = { correct: 0, skipped: 0, wrong: 0 }
  let totalTime = 0
  for (const q of payload.questions) {
    counts[statusOf(q)]++
    totalTime += q.timeMs ?? 0
  }
  const total = fmtTime(totalTime)
  const route =
    payload.tier === 'easy'
      ? 'routed to the easier Module 2'
      : payload.tier === 'hard'
        ? 'routed to the harder Module 2'
        : ''

  const askStatus = askFor ? statusOf(askFor) : null

  return (
    <div className={`cdk${askFor ? ' ask-open' : ''}`} data-mode={mode}>
      <div className="cdk-wrap">
        <header>
          <p className="cdk-eyebrow">
            Score breakdown{payload.testLabel ? <> · TEST <b>{payload.testLabel}</b></> : ''}
          </p>
          <h1>
            {payload.moduleLabel} <em>·</em> {payload.title}
          </h1>
          {route && <p className="cdk-eyebrow mt-2">{route}</p>}
        </header>

        <section className="cdk-panel" aria-label="Question log">
          <div className="cdk-ph">
            <span className="t">
              Question log · <b>{payload.questions.length}</b> questions{total ? ` · ${total} total` : ''}
            </span>
            <span className="cdk-stats">
              <i className="cdk-chip ok">{counts.correct} correct</i>
              <i className="cdk-chip no">{counts.wrong} wrong</i>
              <i className="cdk-chip sk">{counts.skipped} skipped</i>
            </span>
          </div>
          {payload.questions.map((q) => {
            const status = statusOf(q)
            const sfx = SFX[status]
            const isOpen = expanded === q.displayId
            const time = fmtTime(q.timeMs)
            return (
              <div key={q.displayId}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : q.displayId)}
                  aria-expanded={isOpen}
                  className={`cdk-row ${sfx}`}
                >
                  <span aria-hidden="true" className={`cdk-dot ${sfx}`} />
                  <span className="cdk-qid">{q.displayId}</span>
                  <span
                    className={`cdk-time${time ? '' : ' invisible'}`}
                    title={time ? 'Time spent on this question' : undefined}
                  >
                    {time ?? '—'}
                  </span>
                  <span className={`cdk-tag ${sfx}`}>{status}</span>
                  <span aria-hidden="true" className="cdk-caret">
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>
                {isOpen && <ExpandedQuestion q={q} status={status} onAsk={() => setAskFor(q)} />}
              </div>
            )
          })}
        </section>
      </div>

      <AskAiSidebar
        variant="fixed"
        open={!!askFor}
        onClose={() => setAskFor(null)}
        seedKey={askFor?.question.id ?? 'none'}
        label={askFor?.displayId ?? ''}
        context={
          askFor
            ? buildQuestionContext(
                askFor.question,
                askFor.answer,
                askStatus === 'correct' ? true : askStatus === 'wrong' ? false : undefined,
              )
            : ''
        }
        chips={[
          ...(askStatus === 'wrong' ? ['Why is my answer wrong?'] : []),
          'Why is the correct answer right?',
          'What trap does this question set?',
        ]}
      />
    </div>
  )
}

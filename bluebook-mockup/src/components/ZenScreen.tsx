import { useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, LogOut } from 'lucide-react'
import { useSearchParams } from 'react-router'
import type { BankQuestion, ZenDifficulty, ZenSubject } from '../data/live'
import { fetchBank, isCorrect, postEvents, resolveDisplayId, selectBySkills, selectZen } from '../data/live'
import DesmosCalculatorPanel from './DesmosCalculatorPanel'
import QuestionView from './QuestionView'
import RichText from './RichText'
import { formatTime } from './TopBar'

type TimerOpt = 0 | 60 | 90 | 120

interface ZenConfig {
  subject: ZenSubject
  difficulty: ZenDifficulty
  timer: TimerOpt
}

interface SessionEntry {
  q: BankQuestion
  chosen?: string
  correct: boolean | null
  checked: boolean
}

const SUBJECTS: Array<{ id: ZenSubject; label: string }> = [
  { id: 'all', label: 'All subjects' },
  { id: 'math', label: 'Math' },
  { id: 'rw', label: 'Reading & Writing' },
]

function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export default function ZenScreen() {
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState<'run' | 'report'>('run')
  const [config] = useState<ZenConfig>(() => {
    const s = searchParams.get('subject')
    const d = searchParams.get('difficulty')
    const t = Number(searchParams.get('timer'))
    return {
      subject: s === 'math' || s === 'rw' ? s : 'all',
      difficulty: d === 'chill' || d === 'brutal' ? d : 'standard',
      timer: t === 60 || t === 90 || t === 120 ? (t as TimerOpt) : 0,
    }
  })
  const [bank, setBank] = useState<Awaited<ReturnType<typeof fetchBank>> | null>(null)
  const [loading, setLoading] = useState(true)

  const [queue, setQueue] = useState<BankQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [crossed, setCrossed] = useState<Record<string, string[]>>({})
  const [revealed, setRevealed] = useState(false)
  const [lastRight, setLastRight] = useState<boolean | null>(null)
  /** Questions already checked this session — revisiting them re-shows the
   *  reveal instead of allowing a stat-double-counting second check. */
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const [answered, setAnswered] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [run, setRun] = useState(0)
  const [bestRun, setBestRun] = useState(0)

  const [sessionLog, setSessionLog] = useState<SessionEntry[]>([])
  const postedRef = useRef<Set<string>>(new Set())

  const [secondsLeft, setSecondsLeft] = useState(0)
  const [calcOpen, setCalcOpen] = useState(false)
  const lastIdRef = useRef<string | null>(null)
  const shownAtRef = useRef<number>(0)
  const retryId = searchParams.get('retry')
  const retryTier = searchParams.get('tier') ?? undefined
  // display ids (A2-RW2-Q20) resolve to source_ids before matching questions
  const [resolvedRetryId, setResolvedRetryId] = useState<string | null>(retryId)
  const skillsList = useMemo(() => {
    const raw = searchParams.get('skills')
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  }, [searchParams])

  const startWith = (pool: BankQuestion[], timer: TimerOpt) => {
    setQueue(pool)
    setIndex(0)
    setAnswers({})
    setCrossed({})
    setRevealed(false)
    setLastRight(null)
    setCheckedIds(new Set())
    setAnswered(0)
    setCorrectCount(0)
    setRun(0)
    setBestRun(0)
    setSessionLog([])
    postedRef.current = new Set()
    lastIdRef.current = null
    shownAtRef.current = Date.now()
    setSecondsLeft(timer)
    setPhase('run')
  }

  useEffect(() => {
    let cancelled = false
    fetchBank()
      .then(async (b) => {
        if (cancelled) return
        setBank(b)
        // Entering via "RETRY" from Mistakes: that question served first.
        // The retry id may be a practice-test display id (A2-RW2-Q20).
        if (retryId) {
          const resolved = await resolveDisplayId(retryId, retryTier).catch(() => retryId)
          if (cancelled) return
          setResolvedRetryId(resolved)
          const target = [...b.generated, ...b.harvested].find((q) => q.id === resolved)
          if (target) {
            const rest = shuffle(selectZen(b, 'all', 'standard').filter((q) => q.id !== resolved))
            startWith([target, ...rest], 0)
          }
          return
        }
        // Entering via a skill drill from the Cramduck skill map.
        if (skillsList.length > 0) {
          const pool = shuffle(selectBySkills(b, skillsList))
          if (pool.length > 0) startWith(pool, 0)
          return
        }
        // Straight into the run — config was chosen on the Cramduck tab.
        const pool = shuffle(selectZen(b, config.subject, config.difficulty))
        if (pool.length > 0) startWith(pool, config.timer)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryId, skillsList])

  const question = queue[index]

  // Grade the current question, post its event once, and append it to the
  // session log (used by the exit report). Called on Next and on Finish.
  const leaveCurrent = () => {
    if (!question) return
    const chosen = answers[question.id]
    const hasAnswer = !!chosen && chosen.trim() !== ''
    const correct = hasAnswer ? isCorrect(question, chosen!) : null
    if (hasAnswer && !postedRef.current.has(question.id)) {
      postedRef.current.add(question.id)
      postEvents([
        {
          question_id: question.id,
          correct: correct!,
          mode: 'practice',
          time_ms: Date.now() - shownAtRef.current,
          choice_id: question.options ? chosen : undefined,
          grid_in_answer: question.options ? undefined : chosen,
        },
      ]).catch(() => {})
    }
    setSessionLog((log) => [...log, { q: question, chosen, correct, checked: revealed }])
  }

  const finish = () => {
    leaveCurrent()
    setPhase('report')
  }

  // Per-question countdown (pace only). Resets whenever the question changes.
  useEffect(() => {
    if (phase !== 'run' || config.timer === 0 || revealed) return
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [phase, config.timer, revealed, index])

  const answer = question ? answers[question.id] : undefined

  const canCheck =
    !!question && !revealed && !checkedIds.has(question.id) &&
    (question.options ? !!answer : !!answer && answer.trim() !== '')

  const check = () => {
    if (!question || !canCheck) return
    const right = isCorrect(question, answer ?? '')
    setCheckedIds((s) => new Set(s).add(question.id))
    setRevealed(true)
    setLastRight(right)
    setAnswered((n) => n + 1)
    if (right) {
      setCorrectCount((n) => n + 1)
      setRun((r) => {
        const next = r + 1
        setBestRun((b) => Math.max(b, next))
        return next
      })
    } else {
      setRun(0)
    }
  }

  const next = () => {
    leaveCurrent()
    lastIdRef.current = question?.id ?? null
    shownAtRef.current = Date.now()
    setSecondsLeft(config.timer)
    let pool = queue
    let ni = index + 1
    if (ni >= queue.length) {
      let reshuffled = shuffle(queue)
      if (reshuffled.length > 1 && reshuffled[0]!.id === lastIdRef.current) {
        reshuffled = [...reshuffled.slice(1), reshuffled[0]!]
      }
      pool = reshuffled
      ni = 0
      setQueue(reshuffled)
    }
    const target = pool[ni]
    const wasChecked = target ? checkedIds.has(target.id) : false
    setRevealed(wasChecked)
    setLastRight(wasChecked && target ? isCorrect(target, answers[target.id] ?? '') : null)
    setIndex(ni)
  }

  const back = () => {
    if (index === 0) return
    const target = queue[index - 1]!
    // drop the log entry recorded when the target was left, so leaving it
    // again doesn't duplicate it in the session report
    setSessionLog((log) => {
      const last = log[log.length - 1]
      return last && last.q.id === target.id ? log.slice(0, -1) : log
    })
    const wasChecked = checkedIds.has(target.id)
    setRevealed(wasChecked)
    setLastRight(wasChecked ? isCorrect(target, answers[target.id] ?? '') : null)
    shownAtRef.current = Date.now()
    setSecondsLeft(config.timer)
    setIndex(index - 1)
  }

  if (phase === 'report') {
    const right = sessionLog.filter((e) => e.correct === true).length
    const wrong = sessionLog.filter((e) => e.correct === false).length
    const skipped = sessionLog.filter((e) => e.correct === null).length
    const acc = right + wrong > 0 ? Math.round((right / (right + wrong)) * 100) : 0
    return (
      <div className="min-h-screen bg-[#f4f5f7] text-[#1c1c1e]">
        <main className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="text-center text-[30px] font-bold">Session report</h1>
          <p className="mt-2 text-center text-sm text-[#5b616e]">
            {sessionLog.length} questions · {right} right · {wrong} wrong · {skipped} skipped · {acc}%
          </p>

          <div className="mt-8 overflow-hidden rounded-2xl border border-[#d6d9de] bg-white shadow-sm">
            {sessionLog.length === 0 && (
              <p className="px-8 py-10 text-center text-sm text-[#8a8f99]">No questions this session.</p>
            )}
            {sessionLog.map((e, i) => (
              <div key={e.q.id + i} className="flex items-start gap-4 border-b border-[#eef0f4] px-6 py-4 last:border-b-0">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white ${
                    e.correct === true ? 'bg-[#2e7d32]' : e.correct === false ? 'bg-[#c62828]' : 'bg-[#9aa1ad]'
                  }`}
                >
                  {e.correct === true ? '✓' : e.correct === false ? '✗' : '–'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[#8a8f99]">
                    {i + 1} · {e.q.archetype}
                    {e.checked ? '' : ' · not checked'}
                  </p>
                  <p className="mt-1 truncate font-exam-serif text-[15px] text-[#1c1c1e]">{e.q.prompt}</p>
                  <p className="mt-1 text-[13px] text-[#5b616e]">
                    {e.correct === null ? (
                      'Skipped — no answer.'
                    ) : (
                      <>
                        Your answer:{' '}
                        <b className={e.correct ? 'text-[#1b5e20]' : 'text-[#b71c1c]'}>{e.chosen || '—'}</b>
                        {!e.correct && <> · Correct: <b className="text-[#1b5e20]">{e.q.correct}</b></>}
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2.5">
            <button
              onClick={() => window.location.assign('./index.html#zen')}
              className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-[#3c4048] ring-1 ring-[#d6d9de] hover:bg-[#f4f5f7]"
            >
              Back to Cramduck
            </button>
            <button
              onClick={() => {
                if (!bank) return
                startWith(shuffle(selectZen(bank, config.subject, config.difficulty)), config.timer)
              }}
              className="rounded-full bg-[#3b4ed8] px-7 py-2 text-sm font-semibold text-white hover:bg-[#2f3fb8]"
            >
              New session
            </button>
          </div>
        </main>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] text-[#5b616e]">
        {loading ? 'Loading questions…' : 'No questions match this configuration.'}
      </div>
    )
  }

  const module = {
    id: 'zen',
    label: 'Zen mode',
    title: SUBJECTS.find((s) => s.id === config.subject)?.label ?? 'All subjects',
    minutes: 0,
    split: question.section === 'rw',
    questions: queue,
  }

  const acc = answered > 0 ? Math.round((correctCount / answered) * 100) : 100

  return (
    <div className="flex h-screen flex-col bg-[#f4f5f7] text-[#1c1c1e]">
      <header className="relative grid grid-cols-3 items-center border-b border-[#c9cede] bg-[#e8ecf5] px-5 py-2">
        <div className="min-w-0">
          <p className="truncate text-[19px] font-bold text-[#1c1c1e]">
            {module.label}: {module.title}
          </p>
          <span className="mt-0.5 inline-block rounded-full bg-[#1e2350] px-3 py-0.5 text-[12px] font-bold tracking-wide text-white">
            ZEN MODE
          </span>
          {retryId && question.id === resolvedRetryId && (
            <span className="mt-0.5 ml-2 inline-block rounded-full bg-[#c62828] px-3 py-0.5 text-[12px] font-bold tracking-wide text-white">
              DRILLING A MISTAKE
            </span>
          )}
          {skillsList.length > 0 && (
            <span className="mt-0.5 ml-2 inline-block rounded-full bg-[#3b4ed8] px-3 py-0.5 text-[12px] font-bold tracking-wide text-white">
              DRILLING: {skillsList[0]}
              {skillsList.length > 1 ? ` +${skillsList.length - 1}` : ''}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center">
          {config.timer > 0 ? (
            <span
              className={`text-[26px] font-semibold leading-none tabular-nums ${
                secondsLeft === 0 ? 'text-[#c62828]' : 'text-[#1c1c1e]'
              }`}
            >
              {formatTime(secondsLeft)}
            </span>
          ) : (
            <span className="text-[26px] font-semibold leading-none text-[#1c1c1e]">∞</span>
          )}
          <span className="mt-1 text-[12px] font-semibold tabular-nums text-[#5b616e]">
            run {run} ✓ · best {bestRun} · {acc}%
          </span>
        </div>

        <div className="flex items-start justify-end gap-6">
          {!module.split && (
            <button
              onClick={() => setCalcOpen((o) => !o)}
              aria-pressed={calcOpen}
              className={`flex flex-col items-center gap-1 hover:text-[#3b4ed8] ${
                calcOpen ? 'text-[#3b4ed8]' : 'text-[#1c1c1e]'
              }`}
            >
              <Calculator size={20} />
              <span className="text-[13px] font-semibold">Calculator</span>
            </button>
          )}
          <button
            onClick={finish}
            className="flex flex-col items-center gap-1 text-[#1c1c1e] hover:text-[#3b4ed8]"
          >
            <LogOut size={20} />
            <span className="text-[13px] font-semibold">Finish</span>
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden bg-white">
        {!module.split && (
          <DesmosCalculatorPanel
            moduleId="zen"
            open={calcOpen}
            onClose={() => setCalcOpen(false)}
          />
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <QuestionView
            module={module}
            question={question}
            number={index + 1}
            answer={answer}
            flagged={false}
            crossed={crossed[question.id] ?? []}
            onAnswer={(id, v) => setAnswers((p) => ({ ...p, [id]: v }))}
            onToggleFlag={() => {}}
            onToggleCross={(id, letter) =>
              setCrossed((p) => {
                const list = p[id] ?? []
                return { ...p, [id]: list.includes(letter) ? list.filter((l) => l !== letter) : [...list, letter] }
              })
            }
            reveal={revealed}
            hideFlag
          />
        </div>
      </main>

      {revealed && (
        <div className="max-h-[38vh] overflow-y-auto border-t border-[#c9cede] bg-white px-6 py-4">
          <div
            className={`mx-auto max-w-[780px] rounded-lg px-4 py-3 ${
              lastRight ? 'bg-[#e8f5e9]' : 'bg-[#fdecea]'
            }`}
          >
            <p className={`text-[15px] font-bold ${lastRight ? 'text-[#1b5e20]' : 'text-[#b71c1c]'}`}>
              {lastRight ? '✓ Correct — nice.' : `✗ Not quite. Correct answer: ${question.correct}`}
            </p>
            {question.rationale ? (
              <RichText
                text={question.rationale}
                className="mt-2 block font-exam-serif text-[15px] leading-[1.7] text-[#1c1c1e]"
              />
            ) : (
              <p className="mt-2 font-exam-serif text-[15px] italic text-[#5b616e]">No rationale for this one yet.</p>
            )}
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between gap-4 border-t border-[#c9cede] bg-[#e8ecf5] px-6 py-3">
        <div className="flex-1">
          <p className="truncate text-[15px] font-semibold tabular-nums text-[#3c4048]">
            {answered} answered · {correctCount} right
          </p>
        </div>

        <span className="rounded-full bg-[#1c1c1e] px-6 py-2.5 text-[15px] font-semibold text-white">
          Question {index + 1}
        </span>

        <div className="flex flex-1 items-center justify-end gap-2.5">
          <button
            onClick={back}
            disabled={index === 0}
            className="rounded-full bg-white px-6 py-2.5 text-[15px] font-semibold text-[#3b4ed8] ring-1 ring-[#3b4ed8] hover:bg-[#eef0fd] disabled:opacity-40 disabled:ring-[#d6d9de] disabled:text-[#9aa1ad]"
          >
            ← Back
          </button>
          <button
            onClick={check}
            disabled={!canCheck}
            className="rounded-full bg-white px-6 py-2.5 text-[15px] font-semibold text-[#3b4ed8] ring-1 ring-[#3b4ed8] hover:bg-[#eef0fd] disabled:opacity-40 disabled:ring-[#d6d9de] disabled:text-[#9aa1ad]"
          >
            Check
          </button>
          <button
            onClick={next}
            className="rounded-full bg-[#3b4ed8] px-7 py-2.5 text-[15px] font-semibold text-white hover:bg-[#2f3fb8]"
          >
            Next →
          </button>
        </div>
      </footer>
    </div>
  )
}

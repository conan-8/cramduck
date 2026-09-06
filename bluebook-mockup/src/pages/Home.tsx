import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import StartScreen from '../components/StartScreen'
import ExamScreen from '../components/ExamScreen'
import ReviewScreen from '../components/ReviewScreen'
import TransitionScreen from '../components/TransitionScreen'
import BreakScreen from '../components/BreakScreen'
import ResultsScreen from '../components/ResultsScreen'
import LockScreen from '../components/LockScreen'
import { assembleTest, fetchBank, isCorrect, postEvents, selectQuestions, type SourceKind, type TestFocus } from '../data/live'
import { clearCalcState } from '../lib/desmos'
import { probeApi, reportQuestionError } from '../lib/reviewApi'
import type { ExamModule } from '../types/exam'

type Screen = 'start' | 'intro' | 'exam' | 'review' | 'transition' | 'break' | 'results'

// The 10-minute break sits between Section 1 (Reading and Writing) and Section 2 (Math).
const BREAK_BEFORE_MODULE = 2

export default function Home() {
  // ?focus narrows the run to one module or one full section
  // (launched that way from the Cramduck simulator config).
  const [searchParams] = useSearchParams()
  const focusParam = searchParams.get('focus')
  const focus: TestFocus | null =
    focusParam === 'math' || focusParam === 'math-section' || focusParam === 'rw' || focusParam === 'rw-section'
      ? focusParam
      : null
  const [screen, setScreen] = useState<Screen>('start')
  const [test, setTest] = useState<ExamModule[]>([])
  const [bank, setBank] = useState<Awaited<ReturnType<typeof fetchBank>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingStart, setPendingStart] = useState<{
    source: SourceKind
    excludeBluebook: boolean
    verifiedOnly: boolean
  } | null>(null)
  const [moduleIdx, setModuleIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [crossed, setCrossed] = useState<Record<string, string[]>>({})
  const [index, setIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [apiBase, setApiBase] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    probeApi().then((b) => {
      if (!cancelled) setApiBase(b)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Load the live bank once for the start-screen counts.
  useEffect(() => {
    let cancelled = false
    fetchBank()
      .then((b) => {
        if (cancelled) return
        setBank(b)
        setError(null)
      })
      .catch((err) => !cancelled && setError(`Could not reach the question bank: ${String(err)}`))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const module = test[moduleIdx]
  const isLastModule = moduleIdx === test.length - 1
  const running = (screen === 'exam' || screen === 'review') && module !== undefined

  // Per-question dwell tracking + event recording on module submit.
  const dwellRef = useRef<Record<string, number>>({})
  const lastQRef = useRef<string | null>(null)
  const switchRef = useRef<number>(0)
  const postedRef = useRef<Set<string>>(new Set())
  const currentQId = running ? (module.questions[index]?.id ?? null) : null

  useEffect(() => {
    const now = Date.now()
    if (lastQRef.current && lastQRef.current !== currentQId) {
      dwellRef.current[lastQRef.current] =
        (dwellRef.current[lastQRef.current] ?? 0) + (now - switchRef.current)
    }
    lastQRef.current = currentQId
    switchRef.current = now
  }, [currentQId])

  const recordModule = (m: ExamModule, ans: Record<string, string>) => {
    if (postedRef.current.has(m.id)) return
    postedRef.current.add(m.id)
    const now = Date.now()
    if (lastQRef.current) {
      dwellRef.current[lastQRef.current] =
        (dwellRef.current[lastQRef.current] ?? 0) + (now - switchRef.current)
      switchRef.current = now
    }
    const events = m.questions
      .filter((q) => ans[q.id] !== undefined)
      .map((q) => ({
        question_id: q.id.slice(m.id.length + 1),
        correct: isCorrect(q, ans[q.id]!),
        mode: 'exam' as const,
        time_ms: dwellRef.current[q.id] ?? 0,
        choice_id: q.options ? ans[q.id] : undefined,
        grid_in_answer: q.options ? undefined : ans[q.id],
      }))
    postEvents(events).catch(() => {})
  }

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])

  // Time expired: auto-advance to the transition screen (or submit on the last module).
  useEffect(() => {
    if (!running || secondsLeft !== 0) return
    if (module) recordModule(module, answers)
    // Intentional: auto-advance the screen when the module clock hits zero.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScreen(isLastModule ? 'results' : 'transition')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, secondsLeft, isLastModule])

  const beginModule = (i: number) => {
    setModuleIdx(i)
    setIndex(0)
    setSecondsLeft(test[i]!.minutes * 60)
    setScreen('exam')
  }

  const startTest = (source: SourceKind, excludeBluebook: boolean, verifiedOnly: boolean) => {
    // Fresh test: the graphing calculator must not carry over any previous work.
    clearCalcState()
    setPendingStart({ source, excludeBluebook, verifiedOnly })
    Promise.resolve(bank ?? fetchBank())
      .then((b) => {
        setBank(b)
        const assembled = assembleTest(
          selectQuestions(b, source, excludeBluebook, verifiedOnly),
          focus ?? undefined,
        )
        if (assembled.length === 0) {
          setError('No questions available for that source.')
          return
        }
        setTest(assembled)
        setAnswers({})
        setFlags({})
        setCrossed({})
        setError(null)
        setScreen('intro')
      })
      .catch((err) => setError(`Could not load questions: ${String(err)}`))
      .finally(() => setPendingStart(null))
  }

  const submitModule = () => {
    if (module) recordModule(module, answers)
    setScreen(isLastModule ? 'results' : 'transition')
  }

  // After the "This Module Is Over" screen: break before Math, otherwise straight to the next module.
  const advanceAfterTransition = () => {
    const next = moduleIdx + 1
    if (next === BREAK_BEFORE_MODULE && test.length > BREAK_BEFORE_MODULE) setScreen('break')
    else if (next < test.length) beginModule(next)
    else setScreen('results')
  }

  const handleAnswer = (questionId: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [questionId]: value }))

  const handleToggleFlag = (questionId: string) =>
    setFlags((prev) => ({ ...prev, [questionId]: !prev[questionId] }))

  const handleToggleCross = (questionId: string, letter: string) =>
    setCrossed((prev) => {
      const list = prev[questionId] ?? []
      return {
        ...prev,
        [questionId]: list.includes(letter) ? list.filter((l) => l !== letter) : [...list, letter],
      }
    })

  const jumpTo = (i: number) => {
    setIndex(i)
    setScreen('exam')
  }

  const exitToStart = () => setScreen('start')

  if (screen === 'start') {
    return (
      <StartScreen
        onStart={startTest}
        bank={bank}
        loading={loading || pendingStart !== null}
        error={error}
      />
    )
  }

  if (screen === 'intro') {
    return <LockScreen onDone={() => beginModule(0)} />
  }

  if (screen === 'exam') {
    return (
      <ExamScreen
        module={module}
        index={index}
        answers={answers}
        flags={flags}
        crossed={crossed}
        secondsLeft={secondsLeft}
        onAnswer={handleAnswer}
        onToggleFlag={handleToggleFlag}
        onToggleCross={handleToggleCross}
        onNavigate={setIndex}
        onReview={() => setScreen('review')}
        onExit={exitToStart}
        onReport={
          apiBase !== null ? (questionId, note) => reportQuestionError(apiBase, questionId, note) : undefined
        }
      />
    )
  }

  if (screen === 'review') {
    return (
      <ReviewScreen
        module={module}
        answers={answers}
        flags={flags}
        secondsLeft={secondsLeft}
        onJump={jumpTo}
        onBackToTest={() => setScreen('exam')}
        onSubmit={submitModule}
      />
    )
  }

  if (screen === 'transition') {
    return <TransitionScreen onContinue={advanceAfterTransition} />
  }

  if (screen === 'break') {
    return <BreakScreen onResume={() => beginModule(BREAK_BEFORE_MODULE)} />
  }

  return <ResultsScreen test={test} answers={answers} onExit={exitToStart} />
}

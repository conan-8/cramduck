import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import StartScreen from '../components/StartScreen'
import ExamScreen from '../components/ExamScreen'
import ReviewScreen from '../components/ReviewScreen'
import TransitionScreen from '../components/TransitionScreen'
import BreakScreen from '../components/BreakScreen'
import ResultsScreen from '../components/ResultsScreen'
import { assembleTest, fetchBank, fetchPracticeTest, fetchPracticeTestLabels, isCorrect, MODULE2_HARD_THRESHOLD, postEvents, selectQuestions, type PracticeTest, type SourceKind, type TestFocus } from '../data/live'
import { clearCalcState } from '../lib/desmos'
import { probeApi, reportQuestionError } from '../lib/reviewApi'
import type { ExamModule } from '../types/exam'

type Screen = 'start' | 'exam' | 'review' | 'transition' | 'break' | 'results'

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
  // ?test=A3 pins a specific pre-built practice test (otherwise the
  // start-screen dropdown decides)
  const urlTestLabel = searchParams.get('test') ?? undefined
  const [screen, setScreen] = useState<Screen>('start')
  const [test, setTest] = useState<ExamModule[]>([])
  const [practice, setPractice] = useState<PracticeTest | null>(null)
  const [testLabels, setTestLabels] = useState<{ A: string[]; B: string[] } | null>(null)
  const [bank, setBank] = useState<Awaited<ReturnType<typeof fetchBank>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingStart, setPendingStart] = useState<{
    source: SourceKind
    excludeBluebook: boolean
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

  // Load the live bank once for the start-screen counts, plus the pre-built
  // practice-test labels for the source dropdowns.
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
    fetchPracticeTestLabels()
      .then((l) => {
        if (!cancelled) setTestLabels(l)
      })
      .catch(() => {})
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

  /** Adaptive routing: grade module 1 and swap in the easy or hard module 2
   *  (Princeton Review thresholds: RW ≥ 15/27, Math ≥ 14/22 → harder). */
  const routeModule2 = (m: ExamModule, ans: Record<string, string>) => {
    if (!practice) return
    const section = m.id.startsWith('rw') ? 'rw' : m.id.startsWith('math') ? 'math' : null
    if (!section || m.difficultyTier !== 'mixed') return
    const correct = m.questions.filter((q) => {
      const a = ans[q.id]
      return a !== undefined && isCorrect(q, a)
    }).length
    const hard = correct >= MODULE2_HARD_THRESHOLD[section]
    setTest((prev) => {
      const next = [...prev]
      const variant = section === 'rw'
        ? hard ? practice.rw2hard : practice.rw2easy
        : hard ? practice.math2hard : practice.math2easy
      const idx = next.findIndex((x) => x.id.startsWith(section) && x.difficultyTier !== 'mixed')
      if (idx >= 0) next[idx] = variant
      return next
    })
  }

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])

  // Time expired: auto-advance to the transition screen (or submit on the last module).
  useEffect(() => {
    if (!running || secondsLeft !== 0) return
    if (module) {
      recordModule(module, answers)
      // Intentional: swap in the routed Module 2 when the clock hits zero
      // (setTest happens inside routeModule2).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      routeModule2(module, answers)
    }
    // Intentional: auto-advance the screen when the module clock hits zero.
    setScreen(isLastModule ? 'results' : 'transition')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, secondsLeft, isLastModule])

  const beginModule = (i: number) => {
    setModuleIdx(i)
    setIndex(0)
    setSecondsLeft(test[i]!.minutes * 60)
    setScreen('exam')
  }

  const startTest = (source: SourceKind, excludeBluebook: boolean, pickedLabel?: string) => {
    // Fresh test: the graphing calculator must not carry over any previous work.
    clearCalcState()
    // Fresh timing: dwell times and post guards must not carry over either,
    // or repeat question ids would accumulate stale time from the last run.
    dwellRef.current = {}
    lastQRef.current = null
    switchRef.current = 0
    postedRef.current = new Set()
    setPendingStart({ source, excludeBluebook })
    Promise.resolve(bank ?? fetchBank())
      .then(async (b) => {
        setBank(b)
        // Full runs from a harvested source use a pre-built adaptive test
        // (series A = question bank, B = bluebook) when one is available.
        if (!focus && source !== 'generated') {
          const p = await fetchPracticeTest(b, source === 'bank' ? 'A' : 'B', pickedLabel || urlTestLabel).catch(() => null)
          if (p) {
            setPractice(p)
            // module-2 slots are filled with the hard variant until routing decides
            const mods = [p.rw1, p.rw2hard, p.math1, p.math2hard]
            setTest(mods)
            setAnswers({})
            setFlags({})
            setCrossed({})
            setError(null)
            setModuleIdx(0)
            setIndex(0)
            setSecondsLeft(mods[0]!.minutes * 60)
            setScreen('exam')
            return
          }
        }
        setPractice(null)
        const assembled = assembleTest(
          selectQuestions(b, source, excludeBluebook),
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
        setModuleIdx(0)
        setIndex(0)
        setSecondsLeft(assembled[0]!.minutes * 60)
        setScreen('exam')
      })
       .catch((err) => setError(`Could not load questions: ${String(err)}`))
       .finally(() => setPendingStart(null))
   }

  const submitModule = () => {
    if (module) {
      recordModule(module, answers)
      routeModule2(module, answers)
    }
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
        tests={testLabels}
        loading={loading || pendingStart !== null}
        error={error}
      />
    )
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

  return (
    <ResultsScreen
      test={test}
      answers={answers}
      testLabel={practice?.label}
      times={{ ...dwellRef.current }}
      onExit={exitToStart}
    />
  )
}

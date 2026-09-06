import { useState } from 'react'
import type { ExamModule } from '../types/exam'
import TopBar from './TopBar'
import BottomBar from './BottomBar'
import QuestionView from './QuestionView'
import NavigatorSheet from './NavigatorSheet'
import DesmosCalculatorPanel from './DesmosCalculatorPanel'

interface ExamScreenProps {
  module: ExamModule
  index: number
  answers: Record<string, string>
  flags: Record<string, boolean>
  crossed: Record<string, string[]>
  secondsLeft: number
  onAnswer: (questionId: string, value: string) => void
  onToggleFlag: (questionId: string) => void
  onToggleCross: (questionId: string, letter: string) => void
  onNavigate: (index: number) => void
  onReview: () => void
  onExit: () => void
  onReport?: (questionId: string, note: string) => Promise<string | null>
}

export default function ExamScreen({
  module,
  index,
  answers,
  flags,
  crossed,
  secondsLeft,
  onAnswer,
  onToggleFlag,
  onToggleCross,
  onNavigate,
  onReview,
  onExit,
  onReport,
}: ExamScreenProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [timerHidden, setTimerHidden] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportNote, setReportNote] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)
  const question = module.questions[index]
  const isMath = !module.split

  async function submitReport() {
    if (!onReport || reportBusy || !reportNote.trim()) return
    setReportBusy(true)
    const err = await onReport(question.id, reportNote.trim())
    setReportBusy(false)
    if (err) {
      setReportMsg(err)
    } else {
      setReportMsg(null)
      setReportNote('')
      setReportOpen(false)
    }
  }

  return (
    <div className="relative flex h-screen flex-col bg-[#f4f5f7] text-[#1c1c1e]">
      <TopBar
        module={module}
        secondsLeft={secondsLeft}
        hidden={timerHidden}
        calcOpen={calcOpen}
        onToggleCalc={() => setCalcOpen((o) => !o)}
        onToggleHidden={setTimerHidden}
        onExit={onExit}
      />

      <div className="bg-[#e8ecf5] px-4 pb-2.5 pt-1.5">
        <div className="rounded-2xl bg-[#1e2350] py-2.5 text-center text-[15px] font-bold tracking-wide text-white">
          THIS IS A PRACTICE TEST
        </div>
      </div>

      <main className="flex flex-1 overflow-hidden bg-white">
        {isMath && (
          <DesmosCalculatorPanel
            key={module.id}
            moduleId={module.id}
            open={calcOpen}
            onClose={() => setCalcOpen(false)}
          />
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <QuestionView
            module={module}
            question={question}
            number={index + 1}
            answer={answers[question.id]}
            flagged={!!flags[question.id]}
            crossed={crossed[question.id] ?? []}
            onAnswer={onAnswer}
            onToggleFlag={onToggleFlag}
            onToggleCross={onToggleCross}
          />
        </div>
      </main>

      <BottomBar
        index={index}
        total={module.questions.length}
        navOpen={navOpen}
        onToggleNavigator={() => setNavOpen((o) => !o)}
        onBack={() => onNavigate(Math.max(0, index - 1))}
        onNext={() => {
          if (index === module.questions.length - 1) onReview()
          else onNavigate(index + 1)
        }}
        onReport={onReport ? () => setReportOpen(true) : undefined}
      />

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <p className="text-[16px] font-bold">Report question error</p>
            <p className="mt-1 text-[13px] text-[#5b616e]">
              Question {index + 1} ({question.id}). What's wrong with it?
            </p>
            <textarea
              autoFocus
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
              placeholder="Describe the error (wrong text, broken figure, bad math…)"
              className="mt-3 h-28 w-full rounded-md border border-[#6d7380] p-2 text-[14px]"
            />
            {reportMsg && <p className="mt-2 text-[13px] font-semibold text-[#c62828]">{reportMsg}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setReportOpen(false)
                  setReportMsg(null)
                }}
                className="rounded-md border border-[#6d7380] bg-white px-3 py-1.5 text-[13px] font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={reportBusy || !reportNote.trim()}
                onClick={() => void submitReport()}
                className="rounded-md bg-[#3b4ed8] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {reportBusy ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NavigatorSheet
        open={navOpen}
        module={module}
        current={index}
        answers={answers}
        flags={flags}
        onClose={() => setNavOpen(false)}
        onJump={(i) => {
          onNavigate(i)
          setNavOpen(false)
        }}
        onReview={() => {
          setNavOpen(false)
          onReview()
        }}
      />
    </div>
  )
}

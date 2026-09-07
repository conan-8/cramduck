import { useMemo, useState } from 'react'
import { BarChart3, Clock3, LockOpen, PersonStanding } from 'lucide-react'
import { archetypeCounts, type SourceKind } from '../data/live'
import { useAuth } from '../lib/auth-context'
import './start-screen.css'

interface BankData {
  generated: Array<{ kind: string }>
  harvested: Array<{ kind: string }>
}

interface StartScreenProps {
  onStart: (source: SourceKind, excludeBluebook: boolean, testLabel?: string) => void
  bank: BankData | null
  /** Pre-built practice test labels per series (A = bank, B = bluebook). */
  tests: { A: string[]; B: string[] } | null
  loading: boolean
  error: string | null
}

const INFO_ROWS = [
  {
    icon: Clock3,
    title: 'Timing',
    body: 'This practice test is timed like the real thing. Each module has its own countdown clock at the top of the screen, and you can hide it if it distracts you.',
  },
  {
    icon: BarChart3,
    title: 'Scores',
    body: "This mockup doesn't score your test and doesn't show an answer key when you finish.",
  },
  {
    icon: PersonStanding,
    title: 'Assistive Technology (AT)',
    body: 'The real testing app works with assistive technology. This mockup keeps the look and flow, but not every tool is included.',
  },
  {
    icon: LockOpen,
    title: 'No Device Lock',
    body: 'This practice build runs in your browser and does not lock your device the way the real exam does.',
  },
]

const SOURCES: Array<{ kind: SourceKind; label: string; blurb: string; series?: 'A' | 'B'; glow?: boolean }> = [
  {
    kind: 'generated',
    label: 'Generated',
    blurb: 'Original questions from the Cramduck Question Engine',
    glow: true,
  },
  { kind: 'bank', label: 'Question Bank', blurb: 'Items from the online College Board question bank', series: 'A' },
  { kind: 'bluebook', label: 'Bluebook', blurb: 'Bank items that appear in Bluebook practice exams', series: 'B' },
]

export default function StartScreen({ onStart, bank, tests, loading, error }: StartScreenProps) {
  const { user, signOut } = useAuth()
  const [source, setSource] = useState<SourceKind>('generated')
  const [testLabel, setTestLabel] = useState<Record<SourceKind, string>>({ generated: 'G1', bank: '', bluebook: '' })
  const [excludeBluebook, setExcludeBluebook] = useState(false)

  const counts = useMemo(() => {
    if (!bank) return null
    return {
      generated: bank.generated.length,
      bank: bank.harvested.filter((q) => q.kind === 'bank').length,
      bluebook: bank.harvested.filter((q) => q.kind === 'bluebook').length,
    }
  }, [bank])

  const archetypes = useMemo(
    () => (bank ? archetypeCounts(bank as never, source, excludeBluebook) : []),
    [bank, source, excludeBluebook],
  )
  const empty = counts !== null && counts[source] === 0

  const optionsFor = (s: (typeof SOURCES)[number]) =>
    s.kind === 'generated'
      ? [{ value: 'G1', label: 'G1' }]
      : (tests?.[s.series!] ?? []).map((l) => ({ value: l, label: l }))
  const valueFor = (kind: SourceKind) => {
    const s = SOURCES.find((x) => x.kind === kind)!
    return testLabel[kind] || optionsFor(s)[0]?.value || ''
  }

  return (
    <div className="ps-root">
      <header className="ps-mast">
        <div className="ps-brand">
          Cram<span>duck</span>
          <small>SAT simulator · v0.3</small>
        </div>
        <div className="ps-acct">
          <span className="ps-email" title={user?.email ?? undefined}>
            {user?.email}
          </span>
          <button className="ps-mini" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="ps-content">
        <div className="ps-vh">
          <h1>
            Practice <em>test</em>
          </h1>
          <span className="sub">Timed · Bluebook-style · Pick a source below</span>
        </div>

        <section className="ps-panel">
          <div className="ps-ph">
            <span className="t">
              Question source <b>· pick one</b>
            </span>
            <span className="t">{loading ? 'Counting…' : 'Live from the bank'}</span>
          </div>
          <div className="ps-pb">
            <div className="ps-opts">
              {SOURCES.map((s) => {
                const active = source === s.kind
                const n = counts ? counts[s.kind] : null
                const badge = loading ? '…' : n === null ? '' : `${n} items`
                const options = optionsFor(s)
                const value = valueFor(s.kind)
                return (
                  <div key={s.kind} className="ps-optbox">
                    <button
                      type="button"
                      onClick={() => setSource(s.kind)}
                      className={`ps-opt${active ? ' on' : ''}${s.glow ? ' glow' : ''}`}
                      aria-pressed={active}
                    >
                      <span className="n">{s.label}</span>
                      {badge && <span className="cnt">{badge}</span>}
                      <span className="d">{s.blurb}</span>
                    </button>
                    <select
                      className="ps-sel"
                      aria-label={`${s.label} test`}
                      value={value}
                      onChange={(e) => {
                        setSource(s.kind)
                        setTestLabel((prev) => ({ ...prev, [s.kind]: e.target.value }))
                      }}
                    >
                      {options.length === 0 && (
                        <option value="" disabled>
                          {loading ? 'Loading…' : 'No tests'}
                        </option>
                      )}
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>

            <div className="ps-checks">
              <label className="ps-check">
                <input
                  type="checkbox"
                  checked={excludeBluebook}
                  onChange={(e) => setExcludeBluebook(e.target.checked)}
                />
                <span className="cb" aria-hidden="true" />
                Exclude Bluebook questions from any mixed view
              </label>
            </div>

            {archetypes.length > 0 && (
              <details className="ps-arch">
                <summary>
                  By archetype <span className="tw">{archetypes.length} categories ▾</span>
                </summary>
                <div className="rows">
                  {archetypes.map((a) => (
                    <div key={a.archetype} className="r">
                      <span className="k" title={a.archetype}>
                        {a.archetype}
                      </span>
                      <span className="v">{a.count}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {empty && (
              <p className="ps-note">
                no {SOURCES.find((s) => s.kind === source)?.label} questions in the bank yet — pick another source
              </p>
            )}
            {error && <p className="ps-note err">{error}</p>}
          </div>
        </section>

        <section className="ps-panel">
          <div className="ps-ph">
            <span className="t">
              Good to know <b>· before you start</b>
            </span>
          </div>
          <div className="ps-pb">
            {INFO_ROWS.map((row) => (
              <div key={row.title} className="ps-info">
                <span className="ic" aria-hidden="true">
                  <row.icon size={20} />
                </span>
                <div>
                  <p className="t">{row.title}</p>
                  <p className="b">{row.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="ps-disclaim">
          Unofficial mockup with original sample items · Not affiliated with or endorsed by the College Board
        </p>
      </main>

      <footer className="ps-bar">
        <span className="ps-barnote">no scoring here — just reps &amp; feel</span>
        <button type="button" className="ps-btn sec" onClick={() => window.location.assign('./index.html')}>
          ← Back
        </button>
        <button
          type="button"
          className="ps-btn pri"
          onClick={() => onStart(source, excludeBluebook, valueFor(source) || undefined)}
          disabled={loading || empty}
        >
          {loading ? 'Loading…' : 'Start the test →'}
        </button>
      </footer>
    </div>
  )
}

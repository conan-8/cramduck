import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import RichText from './RichText'
import { askCoach, type ChatMessage } from '../lib/ask-ai'

/**
 * AskAiSidebar — the "Ask CramduckAI" chat sidebar shared by zen mode and
 * the score breakdown. Slides in from the right and pushes the question
 * content left:
 *   variant="push"  — flex sibling inside zen's <main>; width animates
 *                     0 → panel width so the question column shrinks.
 *   variant="fixed" — fixed right overlay (score breakdown); the host adds
 *                     an `ask-open` class to slide its own content left.
 * Conversations are kept per `seedKey` (question id) for the lifetime of the
 * mounted sidebar, so flipping Back/Next restores each question's chat.
 */

interface AskAiSidebarProps {
  variant: 'push' | 'fixed'
  open: boolean
  onClose: () => void
  /** Question id — the conversation is kept per key. */
  seedKey: string
  /** Shown in the header (e.g. "Question 4" or a display id like A2-RW2-Q20). */
  label: string
  /** QUESTION CONTEXT block, sent with every request (see lib/ask-ai). */
  context: string
  /** Suggestion chips shown while the conversation is empty. */
  chips: string[]
}

/** Coach reply: paragraphs + bullet lists, inline markup via RichText. */
function CoachText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let list: string[] = []
  const flush = (key: string) => {
    if (!list.length) return
    nodes.push(
      <ul key={key} className="ask-list">
        {list.map((li, i) => (
          <li key={i}>
            <RichText text={li} />
          </li>
        ))}
      </ul>,
    )
    list = []
  }
  text
    .replace(/\r/g, '')
    .split('\n')
    .forEach((raw, i) => {
      const t = raw.trim()
      if (!t) {
        flush(`f${i}`)
        return
      }
      const bullet = t.match(/^[-*•]\s+(.*)$/) ?? t.match(/^\d+[.)]\s+(.*)$/)
      if (bullet) {
        list.push(bullet[1]!)
        return
      }
      flush(`f${i}`)
      nodes.push(
        <p key={i} className="ask-p">
          <RichText text={t.replace(/^#{1,6}\s+/, '')} />
        </p>,
      )
    })
  flush('end')
  return <>{nodes}</>
}

export default function AskAiSidebar({ variant, open, onClose, seedKey, label, context, chips }: AskAiSidebarProps) {
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messages = useMemo(() => conversations[seedKey] ?? [], [conversations, seedKey])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, seedKey])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy, err, open])

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setConversations((c) => ({ ...c, [seedKey]: next }))
    setInput('')
    setBusy(true)
    setErr(null)
    try {
      const reply = await askCoach(next, context)
      setConversations((c) => ({ ...c, [seedKey]: [...next, { role: 'assistant', content: reply }] }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={`ask-panel ${variant}${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="ask-inner">
        <header className="ask-head">
          <div className="min-w-0">
            <p className="ask-eyebrow">Ask CramduckAI</p>
            <p className="ask-sub">discussing {label}</p>
          </div>
          <button type="button" className="ask-x" onClick={onClose} aria-label="Close CramduckAI chat">
            ×
          </button>
        </header>

        <div className="ask-log" ref={logRef}>
          {messages.length === 0 && !busy && (
            <div className="ask-empty">
              <p className="ask-hint">
                Ask anything about this question — the coach can see the prompt, your answer and the
                official rationale.
              </p>
              {chips.length > 0 && (
                <div className="ask-chips">
                  {chips.map((c) => (
                    <button key={c} type="button" onClick={() => send(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ask-msg ${m.role}`}>
              <span className="who">{m.role === 'user' ? 'YOU' : 'COACH'}</span>
              <div className="ask-bubble">
                {m.role === 'user' ? m.content : <CoachText text={m.content} />}
              </div>
            </div>
          ))}
          {busy && (
            <div className="ask-msg coach">
              <span className="who">COACH</span>
              <div className="ask-bubble ask-dots" aria-label="Coach is thinking">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          {err && <p className="ask-err">The coach can’t be reached right now — {err}. Give it another try.</p>}
        </div>

        <form
          className="ask-in"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ask about this question…"
            autoComplete="off"
            maxLength={2000}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Send →
          </button>
        </form>
      </div>
    </aside>
  )
}

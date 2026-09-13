/**
 * ask-ai: plumbing for the "Ask CramduckAI" sidebar (zen mode + score
 * breakdown). Builds the QUESTION CONTEXT block sent to the coach and talks
 * to the existing /api/chat proxy (OpenRouter). The tier follows the hub
 * chat's `cramduck_chat_tier` localStorage key. Conversations are ephemeral
 * (never persisted to Supabase — the hub chat keeps that role).
 */
import type { Question } from '../types/exam'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const TIER_KEY = 'cramduck_chat_tier'
const MAX_SECTION = 3500

function clip(s: string, max = MAX_SECTION): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Strip exam markup so the model sees plain text. */
function plain(s: string): string {
  return s
    .replace(/\{\{(?:imgfull|img):.+?\}\}/g, '[figure]')
    .replace(/\[\[(.+?)\]\]/g, '"$1" (underlined portion)')
    .trim()
}

/**
 * QUESTION CONTEXT block for /api/chat's `context` field. The proxy detects
 * the QUESTION CONTEXT prefix and labels it for the model (see
 * scripts/lib/chat-proxy.ts). `yourAnswer`/`wasCorrect` are undefined when
 * the question was skipped.
 */
export function buildQuestionContext(
  q: Question & { section?: 'rw' | 'math'; domain?: string },
  yourAnswer?: string,
  wasCorrect?: boolean,
): string {
  const lines: string[] = ['QUESTION CONTEXT — the student is asking about this specific question.']
  const section = q.section === 'rw' ? 'Reading & Writing' : q.section === 'math' ? 'Math' : undefined
  lines.push(
    `Section: ${section ?? 'unknown'} · skill: ${q.skill}${q.domain ? ` · domain: ${q.domain}` : ''}`,
  )
  if (q.passage) lines.push('', 'Passage:', clip(plain(q.passage)))
  if (q.table) {
    lines.push('', 'Table:')
    if (q.table.caption) lines.push(clip(plain(q.table.caption), 400))
    lines.push(q.table.columns.join(' | '))
    for (const row of q.table.rows) lines.push(row.map(String).join(' | '))
  }
  lines.push('', 'Question:', clip(plain(q.prompt)))
  if (q.imageAsset) {
    lines.push('(The question includes an image the student can see; its contents are not available as text.)')
  }
  if (q.options) {
    lines.push('', 'Options:')
    q.options.forEach((t, i) => lines.push(`${String.fromCharCode(65 + i)}) ${clip(plain(t), 800)}`))
  }
  lines.push('', `Correct answer: ${q.correct}`)
  if (yourAnswer && yourAnswer.trim()) {
    lines.push(`Student's answer: ${yourAnswer} — ${wasCorrect ? 'CORRECT' : 'WRONG'}`)
  } else {
    lines.push("Student's answer: (skipped — no answer recorded)")
  }
  if (q.rationale) lines.push('', 'Official rationale:', clip(plain(q.rationale)))
  return lines.join('\n')
}

/** POST /api/chat — returns the coach's reply text. Throws on any failure. */
export async function askCoach(messages: ChatMessage[], context: string): Promise<string> {
  let tier: 'fast' | 'pro' = 'pro'
  try {
    if (localStorage.getItem(TIER_KEY) === 'fast') tier = 'fast'
  } catch {
    /* private mode etc. — keep default */
  }
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context, tier }),
  })
  const j = (await r.json().catch(() => ({}))) as { content?: unknown; error?: string }
  if (!r.ok || typeof j.content !== 'string') {
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  // Safety net: drill tokens shouldn't appear without a slug list, but never
  // leak them to the UI if the model emits one anyway.
  return j.content.replace(/\[\[drill:[^\]]*\]\]/g, '').trim()
}

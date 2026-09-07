import type { Question } from '../types/exam'

/**
 * Breakdown-tab handoff: the results screen stashes a module's payload in
 * localStorage under a one-time key and opens `#/breakdown?key=...` in a new
 * browser tab; BreakdownScreen reads the payload and the key is removed.
 */

export interface BreakdownQuestion {
  displayId: string
  question: Question
  answer: string | undefined
}

export interface BreakdownPayload {
  testLabel?: string
  moduleLabel: string
  title: string
  tier?: 'mixed' | 'easy' | 'hard'
  minutes: number
  questions: BreakdownQuestion[]
}

const STORAGE_PREFIX = 'cramduck-breakdown-'

export function openBreakdown(payload: BreakdownPayload): void {
  const key = `${STORAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(key, JSON.stringify(payload))
  const url = `${window.location.origin}${window.location.pathname}#/breakdown?key=${encodeURIComponent(key)}`
  window.open(url, '_blank')
}

/** Read a handoff payload WITHOUT consuming it (safe under StrictMode's
 *  double render). Call `consumeBreakdown(key)` once the screen has it. */
export function readBreakdown(key: string | null): BreakdownPayload | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as BreakdownPayload
  } catch {
    return null
  }
}

export function consumeBreakdown(key: string | null): void {
  if (key) localStorage.removeItem(key)
}

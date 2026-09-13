/**
 * Text highlighting for the exam question view, built on the CSS Custom
 * Highlight API (CSS.highlights + ::highlight() pseudo-elements). Highlights
 * never mutate the DOM, so React can keep re-rendering the question content
 * freely; they are stored as character offsets into the question root and
 * re-applied whenever the question changes.
 */

export type HighlightColor = 'yellow' | 'blue' | 'pink'

export interface StoredHighlight {
  start: number
  end: number
  color: HighlightColor
}

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'blue', 'pink']

/** Session-scoped store: question id → highlights. */
const store = new Map<string, StoredHighlight[]>()

export function getHighlights(questionId: string): StoredHighlight[] {
  return store.get(questionId) ?? []
}

export function addHighlight(questionId: string, h: StoredHighlight): void {
  const list = store.get(questionId) ?? []
  list.push(h)
  store.set(questionId, list)
}

export function highlightSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

/** Character offset of a DOM boundary point relative to the root's text. */
function charOffset(root: Node, container: Node, offset: number): number | null {
  try {
    const pre = document.createRange()
    pre.selectNodeContents(root)
    pre.setEnd(container, offset)
    return pre.toString().length
  } catch {
    return null
  }
}

/** Serialize a Range into character offsets within root. */
export function rangeToOffsets(root: Node, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const start = charOffset(root, range.startContainer, range.startOffset)
  const end = charOffset(root, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

/** Rebuild a Range from character offsets within root. */
export function offsetsToRange(root: Node, start: number, end: number): Range | null {
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let started = false
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const len = text.data.length
    if (!started && acc + len >= start) {
      range.setStart(text, start - acc)
      started = true
    }
    if (started && acc + len >= end) {
      range.setEnd(text, end - acc)
      return range
    }
    acc += len
  }
  return null
}

/** Clear and re-render all stored highlights for a question onto its root. */
export function renderHighlights(root: HTMLElement, questionId: string): void {
  if (!highlightSupported()) return
  for (const color of HIGHLIGHT_COLORS) CSS.highlights.delete(`hl-${color}`)
  const byColor = new Map<HighlightColor, Highlight>(
    HIGHLIGHT_COLORS.map((c) => [c, new Highlight()]),
  )
  for (const h of getHighlights(questionId)) {
    const range = offsetsToRange(root, h.start, h.end)
    if (range) byColor.get(h.color)?.add(range)
  }
  for (const color of HIGHLIGHT_COLORS) {
    const hl = byColor.get(color)
    if (hl && hl.size > 0) CSS.highlights.set(`hl-${color}`, hl)
  }
}

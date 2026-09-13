import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HighlightColor } from '../lib/highlights'
import { addHighlight, highlightSupported, rangeToOffsets, renderHighlights } from '../lib/highlights'

const SWATCHES: Array<{ color: HighlightColor; bg: string; label: string }> = [
  { color: 'yellow', bg: '#ffe066', label: 'Highlight yellow' },
  { color: 'blue', bg: '#8ec5ff', label: 'Highlight blue' },
  { color: 'pink', bg: '#ff9ecb', label: 'Highlight pink' },
]

interface PopupPos {
  x: number
  y: number
  below: boolean
}

/**
 * Selection-driven highlighter for the question view. Attach `rootRef` to the
 * question container; selecting text inside it pops up a color picker that
 * stores the highlight (keyed by question id) and paints it via the CSS
 * Custom Highlight API.
 */
export function useHighlighter(rootRef: React.RefObject<HTMLElement | null>, questionId: string) {
  const [pos, setPos] = useState<PopupPos | null>(null)
  const pendingRange = useRef<Range | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Re-apply stored highlights whenever a (new) question renders.
  useEffect(() => {
    if (rootRef.current) renderHighlights(rootRef.current, questionId)
  }, [questionId, rootRef])

  useEffect(() => {
    if (!highlightSupported()) return

    const onMouseUp = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return
      // Let the browser finish updating the selection before reading it.
      window.setTimeout(() => {
        const sel = window.getSelection()
        const root = rootRef.current
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) {
          setPos(null)
          return
        }
        const range = sel.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) {
          setPos(null)
          return
        }
        pendingRange.current = range.cloneRange()
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          setPos(null)
          return
        }
        const below = rect.top < 56
        setPos({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below })
      }, 0)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node)) setPos(null)
    }

    const onScroll = () => setPos(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPos(null)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [rootRef])

  const apply = useCallback(
    (color: HighlightColor) => {
      const range = pendingRange.current
      const root = rootRef.current
      setPos(null)
      if (!range || !root) return
      const offsets = rangeToOffsets(root, range)
      window.getSelection()?.removeAllRanges()
      pendingRange.current = null
      if (!offsets) return
      addHighlight(questionId, { ...offsets, color })
      renderHighlights(root, questionId)
    },
    [questionId, rootRef],
  )

  const popup =
    pos && highlightSupported()
      ? createPortal(
          <div
            ref={popupRef}
            role="toolbar"
            aria-label="Highlight color"
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-[100] flex items-center gap-1.5 rounded-lg border border-[#d6d9de] bg-white px-2 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
            style={{
              left: pos.x,
              top: pos.y,
              transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
          >
            {SWATCHES.map((s) => (
              <button
                key={s.color}
                type="button"
                title={s.label}
                aria-label={s.label}
                onClick={() => apply(s.color)}
                className="h-6 w-6 rounded-full border border-black/20 transition-transform hover:scale-110"
                style={{ backgroundColor: s.bg }}
              />
            ))}
          </div>,
          document.body,
        )
      : null

  return popup
}

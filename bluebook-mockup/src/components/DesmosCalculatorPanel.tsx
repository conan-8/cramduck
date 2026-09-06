import { useEffect, useRef, useState } from 'react'
import { ChevronsLeftRight, X } from 'lucide-react'
import {
  loadDesmos,
  saveCalcState,
  takeCalcState,
  type DesmosGraphingCalculator,
} from '../lib/desmos'

const MIN_WIDTH = 320
const MAX_RATIO = 0.8

interface DesmosCalculatorPanelProps {
  moduleId: string
  open: boolean
  onClose: () => void
}

/**
 * Docked Desmos graphing calculator (real Desmos API). Sits at the left edge
 * of the question area — while it is open, the question shifts into the
 * remaining space on the right. Drag the divider handle to resize. The Desmos
 * instance stays mounted while closed so work is never lost, and its graph
 * state is also persisted across screens (per module) via lib/desmos.
 */
export default function DesmosCalculatorPanel({ moduleId, open, onClose }: DesmosCalculatorPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const calcRef = useRef<DesmosGraphingCalculator | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let calc: DesmosGraphingCalculator | null = null
    loadDesmos()
      .then((Desmos) => {
        if (cancelled || !containerRef.current) return
        calc = Desmos.GraphingCalculator(containerRef.current, { border: false, keypad: true })
        const saved = takeCalcState(moduleId)
        if (saved !== null) calc.setState(saved)
        calcRef.current = calc
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
      if (calc) {
        saveCalcState(moduleId, calc.getState())
        calc.destroy()
        calcRef.current = null
      }
    }
  }, [moduleId])

  useEffect(() => {
    if (open) calcRef.current?.resize()
  }, [open])

  const beginResize = (e: React.PointerEvent) => {
    const row = panelRef.current?.parentElement
    if (!row) return
    e.preventDefault()
    setResizing(true)
    const onMove = (ev: PointerEvent) => {
      const rect = row.getBoundingClientRect()
      setWidth(Math.min(Math.max(MIN_WIDTH, ev.clientX - rect.left), rect.width * MAX_RATIO))
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      calcRef.current?.resize()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-label="Desmos graphing calculator"
      className={`relative h-full shrink-0 flex-col border-r border-[#c9cede] bg-white ${
        open ? 'flex' : 'hidden'
      } ${width === null ? 'w-1/2' : ''}`}
      style={{ width: width ?? undefined }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#e6e8ec] bg-[#f7f8fa] px-3">
        <span className="text-[12px] font-bold uppercase tracking-wide text-[#3c4048]">
          Desmos Graphing Calculator
        </span>
        <button
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded p-1 text-[#5b616e] hover:bg-[#e9ebef]"
        >
          <X size={16} />
        </button>
      </div>

      {loadError ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[14px] text-[#5b616e]">
          Could not load the Desmos calculator. Check your internet connection and try reloading.
        </div>
      ) : (
        <div ref={containerRef} className={`min-h-0 flex-1 ${resizing ? 'pointer-events-none' : ''}`} />
      )}

      {/* Resize handle on the divider between calculator and question. */}
      <div
        onPointerDown={beginResize}
        aria-hidden="true"
        className="absolute -right-[4px] top-0 z-10 h-full w-[9px] cursor-col-resize touch-none"
      >
        <span className="absolute left-1/2 top-1/2 flex h-8 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] bg-[#1c1c1e] text-white">
          <ChevronsLeftRight size={15} />
        </span>
      </div>
    </section>
  )
}

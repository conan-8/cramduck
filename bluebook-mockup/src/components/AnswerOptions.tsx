import RichText from './RichText'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/** Circled letter with a diagonal slash — the per-option cross-out button. */
function StrikeIcon({ letter }: { letter: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="text-[#1c1c1e]">
      <circle cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <text x="15" y="19.5" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="currentColor">
        {letter}
      </text>
      <line x1="7.5" y1="7.5" x2="22.5" y2="22.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

interface AnswerOptionsProps {
  options: string[]
  selected: string | undefined
  crossed: string[]
  showStrikeButtons: boolean
  onSelect: (letter: string) => void
  onToggleCross: (letter: string) => void
  /** Zen reveal: lock choices and color correct (green) / wrong pick (red). */
  reveal?: boolean
  correctLetter?: string
}

export default function AnswerOptions({
  options,
  selected,
  crossed,
  showStrikeButtons,
  onSelect,
  onToggleCross,
  reveal,
  correctLetter,
}: AnswerOptionsProps) {
  return (
    <div role="radiogroup" aria-label="Answer choices" className="space-y-4">
      {options.map((text, i) => {
        const letter = LETTERS[i]
        const isSelected = selected === letter
        const isCrossed = crossed.includes(letter)
        const isCorrect = reveal && letter === correctLetter
        const isWrongPick = reveal && isSelected && letter !== correctLetter
        const boxCls = reveal
          ? isCorrect
            ? 'border-2 border-[#2e7d32] bg-[#e8f5e9]'
            : isWrongPick
              ? 'border-2 border-[#c62828] bg-[#fdecea]'
              : 'border-[#d6d9de] bg-white opacity-60'
          : isSelected
            ? 'border-2 border-[#3b4ed8] bg-[#eef1fc]'
            : 'border-[#b9bec9] bg-white hover:border-[#7d8494]'
        const circleCls = reveal
          ? isCorrect
            ? 'border-[#2e7d32] bg-[#2e7d32] text-white'
            : isWrongPick
              ? 'border-[#c62828] bg-[#c62828] text-white'
              : 'border-[#c6c9d2] text-[#a3a8b3]'
          : isSelected
            ? 'border-[#3b4ed8] bg-[#3b4ed8] text-white'
            : isCrossed
              ? 'border-[#c6c9d2] text-[#a3a8b3]'
              : 'border-[#6d7380] text-[#1c1c1e]'
        return (
          <div key={letter} className="flex items-center gap-5">
            <button
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                if (reveal || isCrossed) return
                // Drag-selecting text (for highlighting) shouldn't pick the option.
                const sel = window.getSelection()
                if (sel && !sel.isCollapsed) return
                onSelect(letter)
              }}
              className={`relative flex flex-1 items-center gap-4 rounded-xl border px-5 py-3 text-left transition-colors ${boxCls}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${circleCls}`}
              >
                {letter}
              </span>
              <RichText
                text={text}
                className={`font-exam-serif text-[17px] font-medium leading-relaxed ${
                  isCorrect
                    ? 'text-[#1b5e20]'
                    : isWrongPick
                      ? 'text-[#b71c1c]'
                      : isCrossed
                        ? 'text-[#a3a8b3]'
                        : 'text-[#1c1c1e]'
                }`}
              />
              {isCrossed && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t-2 border-[#1c1c1e]" />
              )}
            </button>

            {showStrikeButtons && !reveal && (
              <span className="flex w-12 shrink-0 justify-center">
                {isCrossed ? (
                  <button
                    onClick={() => onToggleCross(letter)}
                    className="text-sm font-semibold text-[#1c1c1e] underline underline-offset-2 hover:text-black"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (isSelected) onSelect('')
                      onToggleCross(letter)
                    }}
                    aria-label={`Cross out option ${letter}`}
                    className="opacity-80 hover:opacity-100"
                  >
                    <StrikeIcon letter={letter} />
                  </button>
                )}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

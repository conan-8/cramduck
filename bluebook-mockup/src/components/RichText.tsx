import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { ReactNode } from 'react'
import { assetUrl } from '../lib/assets'

/**
 * Renders exam content text with light markup:
 *   \(...\)  → inline LaTeX (KaTeX) — generated bank questions carry real math
 *   [[...]]  → underlined span (used for "underlined portion" questions)
 *   **...**  → bold (Text 1/Text 2 headings in paired-passage questions)
 *   *...*    → italic (used for math variables, book titles, etc.)
 */

function renderSegments(text: string, keyPrefix: string): ReactNode[] {
  // Images saved from the API: {{img:path}} inline (math-size) vs
  // {{imgfull:path}} block-level (graph answer options, stimulus figures).
  // NOTE: alternation must be (imgfull|img) — (imgfull?) matches "imgful(l)"
  // and never "img", which left inline tokens rendering as literal text.
  const imgParts = text.split(/\{\{(imgfull|img):(.+?)\}\}/g)
  if (imgParts.length > 1) {
    const nodes: ReactNode[] = []
    for (let i = 0; i < imgParts.length; i += 3) {
      nodes.push(
        <span key={`${keyPrefix}-is${i}`}>{renderSegments(imgParts[i]!, `${keyPrefix}-is${i}`)}</span>,
      )
      if (i + 2 < imgParts.length) {
        const full = imgParts[i + 1] === 'imgfull'
        nodes.push(
          <img
            key={`${keyPrefix}-img${i}`}
            src={assetUrl(imgParts[i + 2]!)}
            alt=""
            className={
              full
                ? 'mx-auto my-3 block h-auto w-auto max-w-full max-h-[360px]'
                : 'mx-1 inline-block max-h-[2.2em] align-middle'
            }
          />,
        )
      }
    }
    return nodes
  }
  // Math first so \( x * y \) never gets italic-mangled; [\s\S] tolerates any
  // stray newlines inside a LaTeX chunk.
  const mathParts = text.split(/\\\(([\s\S]+?)\\\)/g)
  return mathParts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={`${keyPrefix}-m${i}`} dangerouslySetInnerHTML={{ __html: safeKatex(part) }} />
    ) : (
      <span key={`${keyPrefix}-t${i}`}>{renderMarkup(part, `${keyPrefix}-t${i}`)}</span>
    ),
  )
}

function safeKatex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, output: 'html' })
  } catch {
    return tex
  }
}

function renderMarkup(text: string, keyPrefix: string): ReactNode[] {
  const underlineParts = text.split(/\[\[(.+?)\]\]/g)
  return underlineParts.map((part, i) => {
    const inner = renderBold(part, `${keyPrefix}-u${i}`)
    return i % 2 === 1 ? (
      <span key={`${keyPrefix}-u${i}`} className="underline underline-offset-2">
        {inner}
      </span>
    ) : (
      <span key={`${keyPrefix}-u${i}`}>{inner}</span>
    )
  })
}

function renderBold(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-b${i}`}>{renderItalics(part, `${keyPrefix}-b${i}`)}</strong>
    ) : (
      <span key={`${keyPrefix}-b${i}`}>{renderItalics(part, `${keyPrefix}-b${i}`)}</span>
    ),
  )
}

function renderItalics(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/\*(.+?)\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <em key={`${keyPrefix}-i${i}`}>{part}</em> : <span key={`${keyPrefix}-i${i}`}>{part}</span>,
  )
}

export default function RichText({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{renderSegments(text, 'r')}</span>
}

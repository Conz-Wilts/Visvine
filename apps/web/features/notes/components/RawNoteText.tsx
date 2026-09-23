'use client'

// The raw surface of a note: the whole file in a textarea, with the parts the
// record owns drawn muted and closed to input.
//
// An entity note's `type:`, `node:`, `title:` and mirrored fields are held by
// the store on every write (lib/notes/shared/indexNote.ts), so an edit to one
// of them looks saved and is then put back. Raw mode has to say which lines
// those are, and the plain textarea cannot colour a line — so the text is
// painted by a mirror `<pre>` underneath (same font, wrap and metrics) with
// the held spans on a tinted band in the muted token, and the textarea over
// it types in transparent ink with a visible caret. Input aimed at a held span
// is refused before it lands, and the band turns red until the caret leaves
// the held part, so the refusal is seen rather than felt as a dead key; a
// change that reaches one anyway is dropped.

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type RefObject, type SyntheticEvent } from 'react'
import { editTouchesHeld, heldSpans, heldText } from '@/lib/notes/shared/heldKeys'

interface RawNoteTextProps {
  value: string
  onChange: (value: string) => void
  /** Frontmatter keys the record owns; empty for a plain note. */
  heldKeys: readonly string[]
  readOnly: boolean
  className?: string
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

const TYPOGRAPHY = 'font-mono text-sm leading-relaxed whitespace-pre-wrap break-words'
const HELD = 'rounded-sm bg-surface-muted text-fg-muted [box-decoration-break:clone] [-webkit-box-decoration-break:clone] transition-colors duration-300'
const REFUSED = 'rounded-sm bg-danger-bright/15 text-danger-strong [box-decoration-break:clone] [-webkit-box-decoration-break:clone]'

export function RawNoteText({ value, onChange, heldKeys, readOnly, className, textareaRef }: RawNoteTextProps) {
  const spans = useMemo(() => heldSpans(value, heldKeys), [value, heldKeys])
  const heldNow = useRef(heldText(value, heldKeys))
  heldNow.current = heldText(value, heldKeys)
  const [refused, setRefused] = useState(false)
  const refuse = () => setRefused(true)

  // The red clears once the caret stands somewhere it can type.
  const onSelect = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    if (!refused) return
    const el = e.currentTarget
    if (!editTouchesHeld(spans, el.selectionStart, el.selectionEnd)) setRefused(false)
  }

  const onBeforeInput = (e: FormEvent<HTMLTextAreaElement>) => {
    if (spans.length === 0) return
    const el = e.currentTarget
    const native = e.nativeEvent as InputEvent
    let from = el.selectionStart
    let to = el.selectionEnd
    if (from === to && native.inputType?.startsWith('delete')) {
      if (native.inputType.includes('Forward')) to = from + 1
      else from = Math.max(0, from - 1)
    }
    if (editTouchesHeld(spans, from, to)) {
      e.preventDefault()
      refuse()
    }
  }

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    if (spans.length > 0 && heldText(next, heldKeys) !== heldNow.current) {
      // Reached a held span past the guard (a drop, an IME composition): the
      // change is not taken, and the textarea goes back to the note.
      e.target.value = value
      refuse()
      return
    }
    onChange(next)
  }

  // The mirror needs a trailing line to keep the textarea's height when the
  // note ends on a newline.
  const painted = useMemo(() => {
    const parts: { text: string; held: boolean }[] = []
    let at = 0
    for (const span of spans) {
      if (span.start > at) parts.push({ text: value.slice(at, span.start), held: false })
      parts.push({ text: value.slice(span.start, span.end), held: true })
      at = span.end
    }
    if (at < value.length) parts.push({ text: value.slice(at), held: false })
    return parts
  }, [spans, value])

  return (
    <div className={`relative ${className ?? ''}`}>
      <pre aria-hidden className={`pointer-events-none absolute inset-0 m-0 overflow-hidden text-fg ${TYPOGRAPHY}`}>
        {painted.map((part, i) =>
          part.held ? (
            <span key={i} className={refused ? REFUSED : HELD}>
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
        {'\n'}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onBeforeInput={onBeforeInput}
        onChange={onInput}
        onSelect={onSelect}
        onBlur={() => setRefused(false)}
        readOnly={readOnly}
        spellCheck={false}
        className={`relative block h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-fg focus:outline-none ${TYPOGRAPHY}`}
      />
    </div>
  )
}

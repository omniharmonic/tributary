/**
 * The front door: one input that takes a link, a file, or a sentence. It does not ask
 * the host to choose a method; the detector does that.
 */
import { useRef, useState, type DragEvent, type FormEvent } from 'react'

export interface OneBoxSubmit {
  input: string
  file?: File
}

export function OneBox({ onSubmit, busy, autoFocus }: { onSubmit: (s: OneBoxSubmit) => void; busy?: boolean; autoFocus?: boolean }) {
  const [input, setInput] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = !busy && (input.trim().length > 0 || !!file)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ input: input.trim(), file })
  }
  function drop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setFile(f)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (text && !f) setInput(text)
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="onebox">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`panel grid gap-2 p-2 transition-colors ${over ? 'outline outline-2 outline-slate' : ''}`}
      >
        <label className="field">
          <span className="sr-only">Paste a link, or describe an event</span>
          <textarea
            className="textarea border-0 shadow-none focus:outline-none"
            rows={2}
            placeholder="Paste a link, drop a file, or describe an event"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus={autoFocus}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSubmit) onSubmit({ input: input.trim(), file })
              }
            }}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <input ref={fileRef} type="file" className="sr-only" accept=".ics,.csv,.xlsx,image/*,.pdf,text/calendar" onChange={(e) => setFile(e.target.files?.[0])} aria-label="Choose a file" />
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => fileRef.current?.click()}>
              {file ? 'Change file' : 'Choose a file'}
            </button>
            {file ? (
              <span className="flex items-center gap-1">
                {file.name}
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setFile(undefined)} aria-label="Remove file">
                  ×
                </button>
              </span>
            ) : (
              <span className="hidden sm:inline">.ics, .csv, a flyer or a PDF</span>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Looking…' : 'Find events'}
          </button>
        </div>
      </div>
      <p className="hint">Works with Google Calendar, Luma, Meetup, Eventbrite, WordPress and Squarespace sites, any calendar feed, a forwarded invite, or a sentence like &ldquo;Repair caf&eacute;, first Saturdays 10&ndash;1 at the library&rdquo;.</p>
    </form>
  )
}

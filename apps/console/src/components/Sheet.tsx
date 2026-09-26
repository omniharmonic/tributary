import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A bottom sheet on phones, a centred dialog on wider screens. Native <dialog> for focus and Escape. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="sheet-dialog sheet-enter"
      style={{ maxHeight: '90dvh' }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="grid gap-3 overflow-y-auto p-4" style={{ maxHeight: 'calc(90dvh - 56px)' }}>
        {children}
      </div>
    </dialog>
  )
}

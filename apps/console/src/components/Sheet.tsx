import { useEffect, useRef, type ReactNode } from 'react'

/** A bottom sheet on phones, a centred dialog on wider screens. Native <dialog> for focus and Escape. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="sheet-enter m-0 w-full max-w-lg self-end justify-self-center rounded-t-[var(--r-md)] bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40 sm:self-center sm:rounded-[var(--r-md)]"
      style={{ maxHeight: '90dvh' }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2>{title}</h2>
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

import { useState } from 'react'

export function CopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState('')
  return <div className="grid gap-2"><button type="button" className="btn btn-sm justify-self-start" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setStatus('Copied to clipboard.') }
    catch { setStatus('Copying is unavailable. Select and copy the text above.') }
  }}>Copy link</button><span role="status" className="hint">{status}</span></div>
}

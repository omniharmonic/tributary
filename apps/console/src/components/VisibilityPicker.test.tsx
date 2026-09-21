import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Visibility } from '../lib/types'
import { VisibilityPicker } from './VisibilityPicker'

function Harness({ initial = 'public' as Visibility }) {
  const [v, setV] = useState<Visibility>(initial)
  return <VisibilityPicker value={v} onChange={setV} />
}

describe('VisibilityPicker', () => {
  it('shows no honest-terms notice for public', () => {
    render(<Harness />)
    expect(screen.queryByTestId('honest-terms')).toBeNull()
  })
  it('shows the honest-terms notice when a permissioned level is chosen', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText(/Invite only/))
    const notice = screen.getByTestId('honest-terms')
    expect(notice).toBeInTheDocument()
    expect(notice.textContent).not.toMatch(/encrypt|secret|anonymous/i)
  })
  it('warns that unlisted is still public data', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText(/^Unlisted/))
    expect(screen.getByText(/Anyone who has the link, or reads the network directly/)).toBeInTheDocument()
  })
})

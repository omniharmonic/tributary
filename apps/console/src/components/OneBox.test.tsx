import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OneBox } from './OneBox'

describe('OneBox', () => {
  it('disables submit until there is input', () => {
    render(<OneBox onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Preview events' })).toBeDisabled()
  })
  it('submits trimmed text on click and on Ctrl+Enter; Enter allows a new line', () => {
    const onSubmit = vi.fn()
    render(<OneBox onSubmit={onSubmit} />)
    const box = screen.getByPlaceholderText(/Paste a link/)
    fireEvent.change(box, { target: { value: '  https://lu.ma/x  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview events' }))
    expect(onSubmit).toHaveBeenCalledWith({ input: 'https://lu.ma/x', file: undefined })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
  it('accepts a chosen file', () => {
    const onSubmit = vi.fn()
    render(<OneBox onSubmit={onSubmit} />)
    const file = new File(['BEGIN:VCALENDAR'], 'events.ics', { type: 'text/calendar' })
    fireEvent.change(screen.getByLabelText('Choose a file'), { target: { files: [file] } })
    expect(screen.getByText('events.ics')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview events' }))
    expect(onSubmit).toHaveBeenCalledWith({ input: '', file })
  })
})

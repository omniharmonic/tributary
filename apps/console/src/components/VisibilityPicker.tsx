import type { Visibility } from '../lib/types'
import { HonestTermsNotice } from './HonestTermsNotice'

export interface VisibilityOption {
  value: Visibility
  label: string
  detail: string
}

export const OPTIONS: VisibilityOption[] = [
  { value: 'public', label: 'Public', detail: 'Everyone, on every app that reads the network.' },
  { value: 'unlisted', label: 'Unlisted', detail: 'Anyone with the link. Hidden from browsing and search, but still public data.' },
  { value: 'gated', label: 'Public, details for guests', detail: 'Everyone sees the event with a rough location. Confirmed guests see the exact address and any video link.' },
  { value: 'members', label: 'Members of a group', detail: 'Only members of a group you name.' },
  { value: 'invite', label: 'Invite only', detail: 'Only people you invite or approve. No public listing at all.' },
  { value: 'held', label: 'Held for review', detail: 'Keep them here. Nothing is published until you say so.' },
]

export const PERMISSIONED: ReadonlySet<Visibility> = new Set(['gated', 'members', 'invite'])

export function VisibilityPicker({
  value,
  onChange,
  options = OPTIONS,
  name = 'visibility',
  groupName,
  onGroupNameChange,
}: {
  value: Visibility
  onChange: (v: Visibility) => void
  options?: VisibilityOption[]
  name?: string
  groupName?: string
  onGroupNameChange?: (v: string) => void
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm text-ink-soft">Who can see these</legend>
      {options.map((o) => {
        const checked = o.value === value
        return (
          <label key={o.value} className={`flex cursor-pointer gap-3 rounded-[var(--r-md)] border p-3 ${checked ? 'border-ink bg-surface' : 'border-rule bg-surface'}`}>
            <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="mt-1 accent-[var(--c-ochre)]" />
            <span className="grid gap-0.5">
              <span className="font-medium">{o.label}</span>
              <span className="text-sm text-ink-soft">{o.detail}</span>
              {o.value === 'members' && checked && onGroupNameChange ? (
                <input className="input mt-2" placeholder="Group handle, like seedlibrary.freeskool.directory" value={groupName ?? ''} onChange={(e) => onGroupNameChange(e.target.value)} aria-label="Group" />
              ) : null}
            </span>
          </label>
        )
      })}
      {PERMISSIONED.has(value) ? <HonestTermsNotice /> : null}
      {value === 'unlisted' ? <p className="notice">Unlisted is still public data. Anyone who has the link, or reads the network directly, can see it.</p> : null}
    </fieldset>
  )
}

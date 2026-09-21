import { CSV_FIELDS, type CsvField, type CsvInfo } from '../lib/types'

const LABELS: Record<CsvField, string> = {
  name: 'Event name',
  start: 'Start date',
  startTime: 'Start time (if separate)',
  end: 'End date',
  endTime: 'End time (if separate)',
  location: 'Venue or address',
  description: 'Description',
  url: 'Link (RSVP or details)',
  image: 'Image URL',
  price: 'Price',
  tags: 'Tags or category',
  id: 'Your id for the row',
}

const NONE = '__none__'

/**
 * One select per event field, listing the file's columns. Changing one re-runs the
 * preview with the new mapping so the cards below stay honest.
 */
export function CsvMapper({ csv, onChange, busy, lost, lostNotice = 'The file is no longer in this tab. Go back and upload it again to change the matching.', sourceNoun = 'file' }: { csv: CsvInfo; onChange: (mapping: Record<string, string | null>) => void; busy: boolean; lost: boolean; lostNotice?: string; sourceNoun?: 'file' | 'sheet' }) {
  const mapping = csv.mapping
  const set = (field: CsvField, header: string) => {
    onChange({ ...mapping, [field]: header === NONE ? null : header })
  }
  return (
    <section className="panel grid gap-4 p-4" aria-labelledby="csv-mapper-title">
      <div className="grid gap-1">
        <h2 id="csv-mapper-title">Match the columns</h2>
        <p className="text-sm text-ink-soft">We guessed from the headings. Fix anything that is off; the cards update as you go.</p>
      </div>
      {lost ? <p className="notice notice-warn">{lostNotice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {CSV_FIELDS.map((f) => (
          <label key={f} className="field">
            <span>
              {LABELS[f]}
              {f === 'name' || f === 'start' ? <span className="text-warn"> *</span> : null}
            </span>
            <select className="input" value={mapping[f] ?? NONE} onChange={(e) => set(f, e.target.value)} disabled={busy || lost}>
              <option value={NONE}>not in this {sourceNoun}</option>
              {csv.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {csv.unmapped.length ? <p className="hint">Columns we are not using: {csv.unmapped.join(', ')}.</p> : null}
      {csv.sample.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="mb-1 text-left text-ink-soft">First {Math.min(3, csv.sample.length)} rows of your {sourceNoun}</caption>
            <thead>
              <tr>
                {csv.headers.map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.sample.slice(0, 3).map((row, i) => (
                <tr key={i}>
                  {csv.headers.map((h) => (
                    <td key={h} className="max-w-[16rem] truncate border-b border-line px-2 py-1 text-ink-soft" title={row[h] ?? ''}>
                      {row[h] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {busy ? (
        <p className="text-sm text-ink-soft" role="status">
          Re-reading your {sourceNoun}…
        </p>
      ) : null}
    </section>
  )
}

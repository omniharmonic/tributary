export function PublishSteps({ step }: { step: 1 | 2 | 3 }) {
  return <ol className="publish-steps" aria-label="Publishing progress">{['Add a source', 'Review events', 'Publish'].map((label, i) => <li key={label} data-active={i + 1 === step || undefined} data-complete={i + 1 < step || undefined} aria-current={i + 1 === step ? 'step' : undefined}><span aria-hidden="true">{i + 1 < step ? '✓' : i + 1}</span>{label}</li>)}</ol>
}

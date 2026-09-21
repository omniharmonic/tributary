/**
 * The uploaded File from the one-box, kept in memory for the preview page so a CSV
 * column change can re-run the preview without asking for the file again. Lost on
 * reload by design: files never touch storage.
 */
const files = new Map<string, File>()

export function keepPendingFile(previewId: string, file: File | undefined): void {
  if (file) files.set(previewId, file)
}

export function pendingFile(previewId: string): File | undefined {
  return files.get(previewId)
}

/** A re-run gets a new preview id; carry the file across so the next change still works. */
export function movePendingFile(from: string, to: string): void {
  const f = files.get(from)
  if (f) files.set(to, f)
}

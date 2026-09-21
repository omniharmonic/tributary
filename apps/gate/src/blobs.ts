/**
 * Blob bytes on disk, keyed by sha256, two-level fan-out so one directory never
 * holds a million files. The metadata row (space, author, mime) is the store's.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BlobStorage } from '@tributary/spaces-shim'

const ID_RE = /^[a-f0-9]{64}$/

export class FileBlobStorage implements BlobStorage {
  constructor(private readonly dir: string) {}

  private pathFor(id: string): string {
    if (!ID_RE.test(id)) throw new Error('bad blob id')
    return path.join(this.dir, id.slice(0, 2), id.slice(2, 4), id)
  }

  async put(id: string, bytes: Buffer): Promise<void> {
    const p = this.pathFor(id)
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, bytes, { flag: 'w' })
  }

  async get(id: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(id))
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true })
  }
}

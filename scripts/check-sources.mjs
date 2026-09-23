#!/usr/bin/env node
/**
 * Source hygiene: no raw control characters in text sources.
 *
 * We use NUL as a separator in composite keys and hash inputs (`reconcile.ts`,
 * `csv.ts`, `blob-sign.ts` and friends) because it cannot occur in the field values,
 * so it cannot be forged into a collision. That reasoning is sound. Writing it as a
 * *raw byte* in the source is not: `file` then calls the module binary, and, the part
 * that actually bites, **grep silently skips the whole file** -- a codebase search
 * finds nothing in it and the reader never learns why. Two of ours sat undetected in
 * the pipeline's hottest modules.
 *
 * The fix is the escape, never the byte: \u0000 compiles to the identical string, so
 * hashes and HMACs over it are unchanged and no ledger row needs rewriting.
 *
 * Run by `pnpm test`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['apps', 'packages', 'infra', 'scripts', 'docs']
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo', 'build'])
const TEXT = /\.(ts|tsx|js|mjs|cjs|jsx|json|md|yml|yaml|css|html|sql|sh)$/

// Tab, newline and carriage return are the only C0 characters a text source may hold.
const ALLOWED = new Set([0x09, 0x0a, 0x0d])

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(path)
    else if (TEXT.test(name)) yield path
  }
}

const findings = []
for (const root of ROOTS) {
  for (const path of walk(root)) {
    const buf = readFileSync(path)
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i]
      if (b < 0x20 && !ALLOWED.has(b)) {
        let line = 1
        for (let j = 0; j < i; j++) if (buf[j] === 0x0a) line++
        const name = b === 0 ? 'NUL' : '0x' + b.toString(16).padStart(2, '0')
        findings.push({ file: relative(process.cwd(), path), line, name })
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Raw control characters in text sources:')
  console.error('')
  for (const f of findings) console.error('  ' + f.file + ':' + f.line + '  ' + f.name)
  console.error('')
  console.error('Grep skips files containing these, so a codebase search silently misses them.')
  console.error('Write the escape instead of the byte; the compiled string is identical.')
  process.exit(1)
}

console.log('source hygiene: no raw control characters')

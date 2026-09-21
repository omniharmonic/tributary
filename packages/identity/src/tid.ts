/**
 * TIDs (timestamp identifiers): 13 chars of base32-sortable over
 * (microseconds since epoch << 10 | clock id). The lexicon declares `key: tid` for
 * events, so record keys are fresh TIDs minted at first publish and remembered in the
 * ledger (architecture §6).
 */
const B32 = '234567abcdefghijklmnopqrstuvwxyz'
let lastMicros = 0n
const clockId = BigInt(Math.floor(Math.random() * 1024))

function s32(n: bigint, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out = B32[Number(n & 31n)]! + out
    n >>= 5n
  }
  return out
}

export function tid(now = Date.now()): string {
  let micros = BigInt(now) * 1000n
  if (micros <= lastMicros) micros = lastMicros + 1n
  lastMicros = micros
  return s32((micros << 10n) | clockId, 13)
}

export const TID_RE = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/

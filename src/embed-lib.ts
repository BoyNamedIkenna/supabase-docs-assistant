import fs from 'node:fs'
import crypto from 'node:crypto'
import type { Chunk } from './chunker'

export const EMBED_BATCH = 64 // chunks per embedding request
export const INSERT_BATCH = 10 // rows per database request: small requests survive a flaky connection better

export interface Row {
  id: string
  title: string
  heading_path: string[]
  url: string
  file_path: string
  content: string
  tokens: number
  embedding: number[]
}

export interface Deps {
  embedBatch: (texts: string[]) => Promise<{ vectors: number[][]; tokens: number }>
  clearTable: () => Promise<void>
  insertRows: (rows: Row[]) => Promise<void>
  log?: (msg: string) => void
}

export function toRow(c: Chunk, embedding: number[]): Row {
  return {
    id: c.id,
    title: c.title,
    heading_path: c.headingPath,
    url: c.url,
    file_path: c.filePath,
    content: c.content,
    tokens: c.tokens,
    embedding,
  }
}

// ---------- errors and retries ----------

// "Error / Connection error.   <-   TypeError / fetch failed   <-   Error / ENOTFOUND / ..."
// The real reason is usually at the end of the chain of causes.
export function describeError(e: unknown): string {
  const parts: string[] = []
  let cur: any = e
  while (cur && parts.length < 5) {
    parts.push([cur.name, cur.code, cur.message].filter(Boolean).join(' / '))
    cur = cur.cause
  }
  return parts.join('   <-   ')
}

const NETWORK_WORDS = /fetch failed|connection|network|socket|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH/i

// Worth trying again? Yes for network trouble, rate limits and server errors; no for our own mistakes (4xx).
export function isRetryable(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status
  if (typeof status === 'number') {
    if (status === 0 || status === 429 || status >= 500) return true
    if (status >= 400) return false
  }
  return NETWORK_WORDS.test(describeError(e))
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void } = {},
): Promise<T> {
  const tries = opts.tries ?? 5
  const baseMs = opts.baseMs ?? 1000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= tries || !isRetryable(e)) throw e
      const wait = baseMs * 2 ** (attempt - 1) // 1s, 2s, 4s, 8s ...
      opts.log?.(`  ${label} failed (attempt ${attempt}/${tries}): ${describeError(e).slice(0, 160)}. Retrying in ${wait / 1000}s...`)
      await sleep(wait)
    }
  }
}

// ---------- embedding cache ----------

// Remembers every embedding on disk (one JSON line each). A re-run after a failure, or after a small
// change to a few chunks, only pays for the texts it has not seen before.
export function withDiskCache(inner: Deps['embedBatch'], file: string, model: string): Deps['embedBatch'] {
  const keyOf = (text: string) => crypto.createHash('sha256').update(`${model}\n${text}`).digest('hex')
  const cache = new Map<string, number[]>()
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const { k, v } = JSON.parse(line)
        cache.set(k, v)
      } catch {
        /* a half-written last line from an interrupted run: ignore it */
      }
    }
  }

  return async (texts) => {
    const keys = texts.map(keyOf)
    const missing = keys.map((k, i) => (cache.has(k) ? -1 : i)).filter((i) => i >= 0)
    let tokens = 0
    if (missing.length) {
      const res = await inner(missing.map((i) => texts[i]))
      if (res.vectors.length !== missing.length) {
        throw new Error(`Asked for ${missing.length} embeddings, got ${res.vectors.length}`)
      }
      tokens = res.tokens
      const lines = res.vectors.map((v, j) => {
        const k = keys[missing[j]]
        cache.set(k, v)
        return JSON.stringify({ k, v })
      })
      fs.appendFileSync(file, lines.join('\n') + '\n')
    }
    return { vectors: keys.map((k) => cache.get(k)!), tokens }
  }
}

// ---------- the main flow ----------

export async function ingest(chunks: Chunk[], deps: Deps): Promise<{ chunks: number; tokens: number }> {
  const log = deps.log ?? (() => {})

  // 1. Embed everything first. If this fails, the table has not been touched yet.
  const texts = chunks.map((c) => c.text)
  const vectors: number[][] = []
  let tokens = 0
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const res = await deps.embedBatch(batch)
    if (res.vectors.length !== batch.length) {
      throw new Error(`Asked for ${batch.length} embeddings, got ${res.vectors.length}`)
    }
    vectors.push(...res.vectors)
    tokens += res.tokens
    log(`embedded ${Math.min(i + EMBED_BATCH, texts.length)}/${texts.length}`)
  }

  // 2. Replace the table contents with the fresh rows.
  await deps.clearTable()
  const rows = chunks.map((c, i) => toRow(c, vectors[i]))
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await deps.insertRows(rows.slice(i, i + INSERT_BATCH))
    if ((i / INSERT_BATCH) % 10 === 9 || i + INSERT_BATCH >= rows.length) {
      log(`stored ${Math.min(i + INSERT_BATCH, rows.length)}/${rows.length}`)
    }
  }
  return { chunks: rows.length, tokens }
}
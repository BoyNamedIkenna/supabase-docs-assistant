import type { Chunk } from './chunker'

export const EMBED_BATCH = 64 // chunks per embedding request
export const INSERT_BATCH = 25 // rows per database insert (each row carries 1,536 numbers)

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
    log(`stored ${Math.min(i + INSERT_BATCH, rows.length)}/${rows.length}`)
  }
  return { chunks: rows.length, tokens }
}
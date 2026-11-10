import 'dotenv/config'
import fs from 'node:fs'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import type { Chunk } from './chunker'
import { describeError, ingest, withDiskCache, withRetry } from './embed-lib'

const MODEL = 'text-embedding-3-small'
const CACHE_FILE = '.embedding-cache.jsonl'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

// supabase-js returns errors instead of throwing them. Turn one into a thrown error that carries the
// HTTP status, so withRetry can tell "network trouble, try again" from "our request is wrong".
function check(what: string, result: { error: { message: string; details?: string | null } | null; status: number }) {
  if (result.error) {
    const e = new Error(`${what} failed: ${result.error.message} ${result.error.details ?? ''}`.slice(0, 600)) as Error & { status: number }
    e.status = result.status
    throw e
  }
}

async function main() {
  if (!fs.existsSync('chunks.json')) throw new Error('chunks.json not found. Run: npx tsx src/inspect.ts')
  let chunks: Chunk[] = JSON.parse(fs.readFileSync('chunks.json', 'utf8'))

  // npx tsx src/embed.ts --limit 20   ->  only the first 20 chunks, for a trial run
  const flag = process.argv.indexOf('--limit')
  if (flag > -1) chunks = chunks.slice(0, Number(process.argv[flag + 1]))

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5, timeout: 60_000 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))
  const log = console.log

  const embedFromOpenAI = (texts: string[]) =>
    withRetry(
      'embedding request',
      async () => {
        const res = await openai.embeddings.create({ model: MODEL, input: texts })
        const data = [...res.data].sort((a, b) => a.index - b.index) // keep the answers in input order
        return { vectors: data.map((d) => d.embedding), tokens: res.usage.total_tokens }
      },
      { tries: 3, baseMs: 3000, log },
    )

  const result = await ingest(chunks, {
    embedBatch: withDiskCache(embedFromOpenAI, CACHE_FILE, MODEL),
    clearTable: () =>
      withRetry(
        'clearing the table',
        async () => check('Clearing the table', await supabase.from('doc_chunks').delete().neq('id', '')),
        { log },
      ),
    // upsert, not insert: if a request succeeds but its answer gets lost, the retry just overwrites the same rows
    insertRows: (rows) =>
      withRetry(
        'saving rows',
        async () => check('Saving rows', await supabase.from('doc_chunks').upsert(rows, { onConflict: 'id' })),
        { log },
      ),
    log,
  })

  console.log(`Done: ${result.chunks} chunks stored, ${result.tokens} new tokens embedded (cached ones cost nothing).`)
}

main().catch((e) => {
  console.error(`\nFAILED: ${describeError(e)}`)
  console.error('You can simply run the same command again: embeddings already fetched are cached, so it picks up where it stopped.')
  process.exit(1)
})
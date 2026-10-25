import 'dotenv/config'
import fs from 'node:fs'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import type { Chunk } from './chunker'
import { ingest } from './embed-lib'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function main() {
  if (!fs.existsSync('chunks.json')) throw new Error('chunks.json not found. Run: npx tsx src/inspect.ts')
  let chunks: Chunk[] = JSON.parse(fs.readFileSync('chunks.json', 'utf8'))

  // npx tsx src/embed.ts --limit 20   ->  only the first 20 chunks, for a trial run
  const flag = process.argv.indexOf('--limit')
  if (flag > -1) chunks = chunks.slice(0, Number(process.argv[flag + 1]))

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))

  const result = await ingest(chunks, {
    embedBatch: async (texts) => {
      const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts })
      const data = [...res.data].sort((a, b) => a.index - b.index) // keep the answers in input order
      return { vectors: data.map((d) => d.embedding), tokens: res.usage.total_tokens }
    },
    clearTable: async () => {
      const { error } = await supabase.from('doc_chunks').delete().neq('id', '')
      if (error) throw new Error(`Clearing the table failed: ${error.message}`)
    },
    insertRows: async (rows) => {
      const { error } = await supabase.from('doc_chunks').insert(rows)
      if (error) throw new Error(`Insert failed: ${error.message}`)
    },
    log: console.log,
  })

  console.log(`Done: ${result.chunks} chunks stored, ${result.tokens} tokens embedded.`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
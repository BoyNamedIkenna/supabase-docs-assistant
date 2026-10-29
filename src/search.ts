import 'dotenv/config'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { dedupe, type Match } from './search-lib'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function main() {
  const question = process.argv.slice(2).filter((a) => a !== '--vector').join(' ')
  if (!question) throw new Error('Usage: npx tsx src/search.ts "your question"')

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))

  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: question })

  // Ask for 10 so that, after removing duplicates, we still have 5 to show.
  // npx tsx src/search.ts --vector "question"  ->  vector-only search, for comparison
  const vectorOnly = process.argv.includes('--vector')
  const { data, error } = vectorOnly
    ? await supabase.rpc('match_chunks', { query_embedding: emb.data[0].embedding, match_count: 10 })
    : await supabase.rpc('hybrid_match_chunks', {
        query_text: question,
        query_embedding: emb.data[0].embedding,
        match_count: 10,
      })
  if (error) throw new Error(`Search failed: ${error.message}`)

  console.log(`\nQuestion: ${question}   (${vectorOnly ? 'vector only' : 'hybrid'})\n`)
  dedupe(data as Match[], 5).forEach((r, i) => {
    console.log(`${i + 1}. [${(r.similarity ?? r.score ?? 0).toFixed(4)}] ${r.heading_path.join(' > ')}`)
    console.log(`   ${r.url}`)
    console.log(`   ${r.content.replace(/\s+/g, ' ').slice(0, 150)}...\n`)
  })
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
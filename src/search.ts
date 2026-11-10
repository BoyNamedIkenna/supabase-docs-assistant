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
  // npx tsx src/search.ts "question"             -> top 5, with a text preview
  // npx tsx src/search.ts --top 40 "question"    -> a longer, compact list (headings only)
  // add --vector to use vector-only search for comparison
  const raw = process.argv.slice(2)
  const vectorOnly = raw.includes('--vector')
  let top = 5
  const words: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--vector') continue
    if (raw[i] === '--top') { top = Number(raw[++i]) || 5; continue }
    words.push(raw[i])
  }
  const question = words.join(' ')
  if (!question) throw new Error('Usage: npx tsx src/search.ts [--top N] [--vector] "your question"')

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))

  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: question })

  // Ask for twice as many as we show, so that after removing duplicates we still have enough.
  const count = Math.max(10, top * 2)
  const { data, error } = vectorOnly
    ? await supabase.rpc('match_chunks', { query_embedding: emb.data[0].embedding, match_count: count })
    : await supabase.rpc('hybrid_match_chunks', {
        query_text: question,
        query_embedding: emb.data[0].embedding,
        match_count: count,
      })
  if (error) throw new Error(`Search failed: ${error.message} ${error.details ?? ''}`.slice(0, 600))

  console.log(`\nQuestion: ${question}   (${vectorOnly ? 'vector only' : 'hybrid'}, top ${top})\n`)
  dedupe(data as Match[], top).forEach((r, i) => {
    const score = (r.similarity ?? r.score ?? 0).toFixed(4)
    if (top > 5) {
      console.log(`${String(i + 1).padStart(3)}. [${score}] ${r.heading_path.join(' > ')}`)
    } else {
      console.log(`${i + 1}. [${score}] ${r.heading_path.join(' > ')}`)
      console.log(`   ${r.url}`)
      console.log(`   ${r.content.replace(/\s+/g, ' ').slice(0, 150)}...\n`)
    }
  })
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
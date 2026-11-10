import 'dotenv/config'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { dedupe, type Match } from './search-lib'
import { SYSTEM_PROMPT, buildPrompt, citedNumbers, isNotFound, tidyAnswer } from './ask-lib'
import { rerank } from './rerank-lib'

const CANDIDATES = 30 // how many chunks we retrieve
const SOURCES = 8 // how many of them the answering model sees, after re-ranking

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function main() {
  const debug = process.argv.includes('--debug') // npx tsx src/ask.ts --debug "question"
  const question = process.argv.slice(2).filter((a) => a !== '--debug').join(' ')
  if (!question) throw new Error('Usage: npx tsx src/ask.ts "your question"')

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))
  const chatModel = process.env.CHAT_MODEL ?? 'gpt-5.4-nano'
  const rerankModel = process.env.RERANK_MODEL ?? chatModel

  // 1. Retrieve a wide pool: embed the question, then hybrid search
  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: question })
  const { data, error } = await supabase.rpc('hybrid_match_chunks', {
    query_text: question,
    query_embedding: emb.data[0].embedding,
    match_count: CANDIDATES * 2, // twice as many, so that after removing duplicates we still have enough
  })
  if (error) throw new Error(`Search failed: ${error.message} ${error.details ?? ''}`.slice(0, 600))
  const candidates = dedupe(data as Match[], CANDIDATES)

  // 2. Re-rank: a model reads short excerpts of all candidates and picks the ones that best answer the question
  const { ranked, fallback } = await rerank(question, candidates, SOURCES, async (system, user) => {
    const res = await openai.chat.completions.create({
      model: rerankModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    return res.choices[0].message.content ?? ''
  })
  const sources = ranked.map((r) => r.match)
  if (debug) {
    console.log(`\nRetrieved ${candidates.length} candidates; the model sees these ${sources.length}:`)
    ranked.forEach((r, i) => console.log(`  [${i + 1}] (was #${r.from})  ${r.match.heading_path.join(' > ')}`))
    if (fallback) console.log(`  NOTE: used the original order because ${fallback}`)
  }

  // 3. Generate: answer using only those sources
  const completion = await openai.chat.completions.create({
    model: chatModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(question, sources) },
    ],
  })
  const answer = tidyAnswer(completion.choices[0].message.content ?? '')

  // 4. Show the answer and the sources it used
  if (isNotFound(answer)) {
    console.log("\nI couldn't find that in the Supabase auth and database docs.\n")
    return
  }
  console.log(`\n${answer}\n`)
  const cited = citedNumbers(answer, sources.length)
  const shown = cited.length ? cited : sources.map((_, i) => i + 1)
  console.log(cited.length ? 'Sources used:' : 'Sources retrieved (the answer cited none):')
  for (const n of shown) console.log(`  [${n}] ${sources[n - 1].heading_path.join(' > ')}\n      ${sources[n - 1].url}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
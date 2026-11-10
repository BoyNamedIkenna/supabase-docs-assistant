import 'dotenv/config'
import fs from 'node:fs'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import type { Match } from './search-lib'
import { compact, evaluate, normalizePage, splitByIndex, summarize, type Case, type Mode } from './eval-lib'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function main() {
  const file = process.argv[2] ?? 'eval/questions.json'
  const allCases: Case[] = JSON.parse(fs.readFileSync(file, 'utf8'))

  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))

  // 1. Is each expected page actually in the index? A page we never indexed can't be found.
  const pages = [...new Set(allCases.flatMap((c) => c.expect.map(normalizePage)))]
  const indexed = new Set<string>()
  for (const page of pages) {
    const { count, error } = await supabase
      .from('doc_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('file_path', page)
    if (error) throw new Error(`Index check failed: ${error.message}`)
    if ((count ?? 0) > 0) indexed.add(page)
  }
  const { scored: cases, skipped, missingPages } = splitByIndex(allCases, indexed)

  if (missingPages.size) {
    console.log('\nTEST-DATA PROBLEMS: expected pages that are NOT in the index')
    for (const [page, qs] of missingPages) console.log(`  ${page}\n     <- ${qs.join(' | ')}`)
    console.log(`  ${skipped.length} question(s) have no expected page in the index and are left out of the score.`)
  }

  // 2. Run the questions
  const cache = new Map<string, number[]>() // embed each question once, even though we search twice
  const embed = async (q: string) => {
    if (!cache.has(q)) {
      const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q })
      cache.set(q, res.data[0].embedding)
    }
    return cache.get(q)!
  }

  const results = await evaluate(cases, async (question, mode: Mode) => {
    const query_embedding = await embed(question)
    const { data, error } =
      mode === 'vector'
        ? await supabase.rpc('match_chunks', { query_embedding, match_count: 10 })
        : await supabase.rpc('hybrid_match_chunks', { query_text: question, query_embedding, match_count: 10 })
    if (error) throw new Error(`Search failed: ${error.message}`)
    return data as Match[]
  })

  const show = (r: number | null) => (r === null ? '-' : String(r)).padStart(6)
  console.log('\n hybrid vector  question')
  for (const r of results) console.log(`${show(r.ranks.hybrid)}${show(r.ranks.vector)}   ${r.question}`)

  for (const mode of ['hybrid', 'vector'] as const) {
    const s = summarize(results.map((r) => r.ranks[mode]))
    console.log(`\n${mode.padEnd(6)}: right page ranked 1st for ${s.top1}/${s.n}, in top 3 for ${s.top3}/${s.n}, in top 5 for ${s.top5}/${s.n}   (MRR ${s.mrr.toFixed(2)})`)
  }

  const notFirst = results.filter((r) => r.ranks.hybrid !== 1)
  if (notFirst.length) {
    console.log('\nNot ranked first by hybrid search (pages that came back, best first):')
    for (const r of notFirst) {
      console.log(`\n  ${r.question}`)
      console.log(`     expected: ${r.expect.join(', ')}`)
      console.log(`     got:      ${compact(r.top)}`)
    }
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
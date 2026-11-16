import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createDeps } from './clients'
import { retrieve, type Deps } from './answer'
import { MODES, MODE_LABEL, compact, evaluate, movement, normalizePage, splitByIndex, summarize, type Case, type Mode } from './eval-lib'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function main() {
  const file = process.argv[2] ?? 'eval/questions.json'
  const allCases: Case[] = JSON.parse(fs.readFileSync(file, 'utf8'))

  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))
  const base = createDeps()

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
  if (cases.length === 0) {
    console.log('\nNothing to score.')
    return
  }

  // 2. Three ways of picking the sources, all run through the SAME retrieve() the app uses
  const embedded = new Map<string, Promise<number[]>>() // embed each question once
  const embed = (q: string) => {
    if (!embedded.has(q)) embedded.set(q, base.embed(q))
    return embedded.get(q)!
  }
   const vectorSearch: Deps['search'] = async (_question, embedding, count) => {
    const { data, error } = await supabase.rpc('match_chunks', { query_embedding: embedding, match_count: count })
    if (error) throw new Error(`Search failed: ${error.message} ${error.details ?? ''}`.slice(0, 600))
    return data as Match[]
  }
  const variants: Record<Mode, Deps> = {
    vector: { ...base, embed, useRerank: false, search: vectorSearch },
    vrerank: { ...base, embed, useRerank: true, search: vectorSearch }
  }

    const fallbacks: Partial<Record<Mode, number>> = {}
  const results = await evaluate(cases, async (question, mode) => {
    const { ranked, fallback } = await retrieve(question, variants[mode])
    if (fallback) fallbacks[mode] = (fallbacks[mode] ?? 0) + 1
    return ranked.map((r) => r.match)
  })
  

  // 3. Report
   const show = (r: number | null) => (r === null ? '-' : String(r)).padStart(15)
  console.log(`\n${MODES.map((m) => MODE_LABEL[m].padStart(15)).join('')}   question`)
  for (const r of results) console.log(`${MODES.map((m) => show(r.ranks[m])).join('')}   ${r.question}`)

  console.log(`\nScored ${cases.length} question(s). The right page counts as FOUND if it is among the sources the answering model would see (up to 8).\n`)
  for (const m of MODES) {
    const s = summarize(results.map((r) => r.ranks[m]))
    console.log(`${MODE_LABEL[m].padEnd(14)} found ${s.found}/${s.n}   in top 3: ${s.top3}/${s.n}   first: ${s.top1}/${s.n}   MRR ${s.mrr.toFixed(2)}`)
  }

    const pairs: [Mode, Mode][] = [['vector', 'vrerank']]
  for (const [from, to] of pairs) {
    const mv = movement(results, from, to)
    console.log(`\n${MODE_LABEL[from]} -> ${MODE_LABEL[to]}: gained ${mv.gained.length}, lost ${mv.lost.length}`)
    for (const q of mv.gained) console.log(`  + ${q}`)
    for (const q of mv.lost) console.log(`  - ${q}`)
  }
  for (const m of MODES) {
    if (fallbacks[m]) {
      console.log(`NOTE: ${MODE_LABEL[m]} fell back to the original order for ${fallbacks[m]} question(s), so its numbers understate it.`)
    }
  }

  const weak = results.filter((r) => r.ranks.vrerank === null || r.ranks.vrerank > 3)
  if (weak.length) {
    console.log('\nNot found, or ranked below 3rd, by the real system (vector+vrerank):')

    for (const r of weak) {
      console.log(`\n  ${r.question}`)
      console.log(`     expected: ${r.expect.join(', ')}`)
      console.log(`     got:      ${compact(r.pages.vrerank)}`)
    }
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
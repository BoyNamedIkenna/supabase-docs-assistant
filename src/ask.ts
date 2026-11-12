import 'dotenv/config'
import { answerQuestion } from './answer'
import { createDeps } from './clients'

async function main() {
  const debug = process.argv.includes('--debug') // npx tsx src/ask.ts --debug "question"
  const question = process.argv.slice(2).filter((a) => a !== '--debug').join(' ')
  if (!question) throw new Error('Usage: npx tsx src/ask.ts "your question"')

  const result = await answerQuestion(question, createDeps())

  if (debug) {
    console.log(`\nRetrieved ${result.meta.candidates} candidates; the model saw these ${result.meta.considered.length}:`)
    result.meta.considered.forEach((c, i) => console.log(`  [${i + 1}] (was #${c.from})  ${c.headingPath.join(' > ')}`))
    if (result.meta.rerankFallback) console.log(`  NOTE: used the original order because ${result.meta.rerankFallback}`)
  }

  if (result.notFound) {
    console.log("\nI couldn't find that in the Supabase auth and database docs.\n")
    return
  }
  console.log(`\n${result.answer}\n`)
  const cited = result.sources.filter((s) => s.cited)
  const shown = cited.length ? cited : result.sources
  console.log(cited.length ? 'Sources used:' : 'Sources retrieved (the answer cited none):')
  for (const s of shown) console.log(`  [${s.number}] ${s.headingPath.join(' > ')}\n      ${s.url}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
import 'dotenv/config'
import dns from 'node:dns/promises'
import { createClient } from '@supabase/supabase-js'

// Walks down the chain of "cause" errors, which is where the real reason hides.
function causeChain(e: unknown): string {
  const parts: string[] = []
  let cur: any = e
  while (cur && parts.length < 5) {
    parts.push([cur.name, cur.code, cur.message].filter(Boolean).join(' / '))
    cur = cur.cause
  }
  return parts.join('   <-   ')
}

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`OK    ${name}: ${await fn()}`)
  } catch (e) {
    console.log(`FAIL  ${name}: ${causeChain(e)}`)
  }
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  console.log(`Node ${process.version}`)
  console.log(`proxy variables set: ${Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)}`)
  console.log('\n1. .env values (shapes only, no secrets printed)')
  console.log(`   SUPABASE_URL set: ${Boolean(url)}`)
  console.log(`   SUPABASE_SECRET_KEY set: ${Boolean(key)}`)
  console.log(`   OPENAI_API_KEY set: ${Boolean(openaiKey)}`)
  if (!url || !key) return

  console.log(`   starts with https://: ${url.startsWith('https://')}`)
  console.log(`   ends with .supabase.co (no slash, no path): ${/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)}`)

  const host = new URL(url).hostname
  console.log('\n2. Network checks')
  await step('DNS lookup of the project host', async () => {
    const addrs = await dns.lookup(host, { all: true })
    return `${addrs.length} address(es), families: ${addrs.map((a) => 'IPv' + a.family).join(', ')}`
  })
  await step('HTTPS request to the project', async () => {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) })
    return `HTTP ${res.status}`
  })
  await step('Query the doc_chunks table', async () => {
    const { count, error } = await createClient(url, key)
      .from('doc_chunks')
      .select('id', { count: 'exact', head: true })
    if (error) throw new Error(JSON.stringify(error).slice(0, 300))
    return `${count} rows`
  })
  await step('Reach OpenAI (for comparison)', async () => {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${openaiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    return `HTTP ${res.status}`
  })
}

main()
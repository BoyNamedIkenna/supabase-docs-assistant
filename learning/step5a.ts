import path from 'node:path'
import { chunkFile } from '../src/chunker.js'

const guidesRoot = 'source/apps/docs/content/guides'
const files = [
  'database/postgres/row-level-security-performance.mdx',
  'database/postgres/row-level-security.mdx',
]

for (const f of files) {
  const chunks = chunkFile(path.join(guidesRoot, f), guidesRoot)
  console.log(`\n##### ${f}: ${chunks.length} chunks`)
  for (const c of chunks) {
    console.log(`${String(c.tokens).padStart(5)} tokens | ${c.headingPath.join(' > ')}`)
    console.log(`        ${c.url}`)
  }
}

const demo = chunkFile(path.join(guidesRoot, files[0]), guidesRoot)[3]
console.log('\n===== text that will be embedded (chunk 3) =====')
console.log(demo.text)
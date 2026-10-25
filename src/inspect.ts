import fs from 'node:fs'
import path from 'node:path'
import { chunkFile, MAX_TOKENS } from './chunker'
import { componentCounts } from './clean'
import { nextFence, type Fence } from './sections'

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return full.endsWith('.mdx') ? [full] : []
  })
}

// Lines of a chunk that are outside code blocks and still contain something tag-like
function leftoverTags(content: string): string[] {
  let fence: Fence = null
  const found: string[] = []
  for (const line of content.split('\n')) {
    const wasOutside = fence === null
    fence = nextFence(fence, line)
    if (!(wasOutside && fence === null)) continue
    const noInlineCode = line.replace(/`[^`]*`/g, '')
    if (/<\/?\$?[A-Z][A-Za-z0-9]*(\s|>|\/|$)/.test(noInlineCode) || /\{\/\*|\*\/\}/.test(noInlineCode)) found.push(line.trim())
  }
  return found
}

function kind(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l))
  if (lines.length && lines.every((l) => l.trim().startsWith('|'))) return 'table'
  if (lines.length && /^\s*```/.test(lines[0])) return 'code'
  return 'other'
}

const guidesRoot = process.argv[2] ?? 'source/apps/docs/content/guides'
const folders = process.argv.slice(3).length ? process.argv.slice(3) : ['auth', 'database']

const files = folders.flatMap((f) => walk(path.join(guidesRoot, f)))
const chunks = files.flatMap((f) => chunkFile(f, guidesRoot))
fs.writeFileSync('chunks.json', JSON.stringify(chunks, null, 2))

const t = chunks.map((c) => c.tokens).sort((a, b) => a - b)
console.log(`files: ${files.length}   chunks: ${chunks.length}`)
console.log(`tokens per chunk: min ${t[0]}, median ${t[Math.floor(t.length / 2)]}, max ${t[t.length - 1]}`)
const counts = [...componentCounts.entries()].sort((a, b) => b[1] - a[1])
console.log(`components found: ${counts.map(([n, c]) => `${n}(${c})`).join(', ') || 'none'}`)

const small = chunks.filter((c) => c.tokens < 30)
console.log(`\nchunks under 30 tokens: ${small.length}`)
small.slice(0, 8).forEach((c) => console.log(`  ${c.tokens}t  ${c.filePath} > ${c.headingPath.slice(1).join(' > ')}`))

const big = chunks.filter((c) => c.tokens > MAX_TOKENS)
console.log(`\nchunks over ${MAX_TOKENS} tokens (single blocks that can't be split): ${big.length}`)
const byKind: Record<string, number> = {}
big.forEach((c) => { const k = kind(c.content); byKind[k] = (byKind[k] ?? 0) + 1 })
console.log(`  by type: ${JSON.stringify(byKind)}`)
big.slice(0, 8).forEach((c) => console.log(`  ${c.tokens}t  ${c.filePath} > ${c.headingPath.slice(1).join(' > ')}`))

const leftovers = chunks.flatMap((c) => leftoverTags(c.content).map((l) => `${c.filePath}: ${l}`))
console.log(`\nlines with leftover tag-like text outside code: ${leftovers.length}`)
leftovers.slice(0, 10).forEach((l) => console.log(`  ${l}`))
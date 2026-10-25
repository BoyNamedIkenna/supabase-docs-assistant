import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { splitSections, nextFence, type Fence } from './sections'
import { cleanLine, cleanSectionLines, stripMdxComments } from './clean'
import { resolveIncludes } from './includes'

export const MAX_TOKENS = 500 // sections bigger than this get split
export const MIN_TOKENS = 100 // a heading with less text than this merges into its first subsection

export interface Chunk {
  id: string
  title: string
  headingPath: string[]
  url: string
  filePath: string
  content: string // cleaned text, shown to the user as a source
  text: string // heading path + content, this is what gets embedded
  tokens: number
}

interface Piece { headingPath: string[]; anchor: string; content: string }

export const estimateTokens = (t: string) => Math.ceil(t.length / 4)
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

// true if `child` sits somewhere below `parent` in the heading tree
function isChild(parent: string[], child: string[]): boolean {
  return child.length > parent.length && parent.every((h, i) => h === child[i])
}

// True if the chunk has enough real words once its heading lines are ignored.
// Link-only stubs ("See the Cron docs.") and lone tab labels fail this test.
// A chunk that contains a code block only needs a few characters of text.
const hasBodyText = (text: string) => {
  const body = text
    .split('\n')
    .filter((l) => !/^#{1,6}\s/.test(l))
    .join('\n')
  const hasCode = /^\s*(```|~~~)/m.test(body)
  return body.replace(/[^A-Za-z0-9]/g, '').length >= (hasCode ? 5 : 30)
}
// A heading with almost no text, followed by its own first subsection,
// gets merged into that subsection. The merged piece keeps the subsection's
// (more specific) heading path and anchor.
function mergeShortParents(pieces: Piece[]): Piece[] {
  const work = [...pieces]
  const out: Piece[] = []
  for (let i = 0; i < work.length; i++) {
    const cur = work[i]
    const next = work[i + 1]
    if (next && estimateTokens(cur.content) < MIN_TOKENS && isChild(cur.headingPath, next.headingPath)) {
      work[i + 1] = { ...next, content: `${cur.content}\n\n${next.content}` }
    } else {
      out.push(cur)
    }
  }
  return out
}

// Splits on blank lines, but never inside a code block.
function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let fence: Fence = null
  for (const line of text.split('\n')) {
    fence = nextFence(fence, line)
    if (fence === null && line.trim() === '') {
      if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
    } else {
      cur.push(line)
    }
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

const isTableBlock = (block: string) => {
  const lines = block.split('\n')
  return (
    lines.length >= 3 &&
    lines.every((l) => l.trim().startsWith('|')) &&
    /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(lines[1])
  )
}

// Splits a big table into several smaller tables, repeating the header row in each.
function splitTable(block: string): string[] {
  const lines = block.split('\n')
  const header = lines.slice(0, 2).join('\n')
  const parts: string[] = []
  let rows: string[] = []
  for (const row of lines.slice(2)) {
    if (rows.length > 0 && estimateTokens([header, ...rows, row].join('\n')) > MAX_TOKENS) {
      parts.push([header, ...rows].join('\n'))
      rows = []
    }
    rows.push(row)
  }
  if (rows.length) parts.push([header, ...rows].join('\n'))
  return parts
}

// Packs blocks together until adding the next one would pass MAX_TOKENS.
// A single block bigger than MAX_TOKENS (e.g. a huge code block) stays whole.
function splitOversized(content: string): string[] {
  const parts: string[] = []
  let cur = ''
  const blocks = splitBlocks(content).flatMap((b) =>
    estimateTokens(b) > MAX_TOKENS && isTableBlock(b) ? splitTable(b) : [b],
  )
  for (const block of blocks) {
    if (cur && estimateTokens(`${cur}\n\n${block}`) > MAX_TOKENS) {
      parts.push(cur)
      cur = block
    } else {
      cur = cur ? `${cur}\n\n${block}` : block
    }
  }
  if (cur) parts.push(cur)
  return parts
}

export function chunkFile(filePath: string, guidesRoot: string): Chunk[] {
  const { data, content } = matter(fs.readFileSync(filePath, 'utf8'))
  const rel = path.relative(guidesRoot, filePath).replace(/\\/g, '/').replace(/\.mdx$/, '')
  const title = String(data.title ?? path.basename(rel))
  const pageUrl = `https://supabase.com/docs/guides/${rel}`

  // 0. fill in shared partials and code samples, then drop comments
  const fullText = stripMdxComments(
    resolveIncludes(stripMdxComments(content), {
      partialsRoot: path.resolve(guidesRoot, '..', '_partials'),
      examplesRoot: path.resolve(guidesRoot, '..', '..', '..', '..', 'examples'),
    }),
  )

  // 1. one piece per section
  const pieces: Piece[] = []
  const stack: string[] = []
  for (const section of splitSections(fullText, true)) {
    let headingPath = [title]
    let headingLine = ''
    let anchor = ''
    if (section.level > 0) {
      const heading = cleanLine(section.title)
      stack.length = section.level - 2
      stack[section.level - 2] = heading
      headingPath = [title, ...stack.filter(Boolean)]
      headingLine = `${'#'.repeat(section.level)} ${heading}\n\n`
      anchor = slugify(heading)
    }
    const body = cleanSectionLines(section.lines).join('\n')
    const text = (headingLine + body).replace(/\n{3,}/g, '\n\n').trim()
    if (text !== '') pieces.push({ headingPath, anchor, content: text })
  }

  // 2. merge short parents, 3. split oversized pieces, 4. build the chunk objects
  const chunks: Chunk[] = []
  for (const piece of mergeShortParents(pieces)) {
    const parts = estimateTokens(piece.content) > MAX_TOKENS ? splitOversized(piece.content) : [piece.content]
    for (const part of parts) {
      if (!hasBodyText(part)) continue // nothing left but headings or punctuation
      chunks.push({
        id: `${rel}::${chunks.length}`,
        title,
        headingPath: piece.headingPath,
        url: piece.anchor ? `${pageUrl}#${piece.anchor}` : pageUrl,
        filePath: rel,
        content: part,
        text: `${piece.headingPath.join(' > ')}\n\n${part}`,
        tokens: estimateTokens(part),
      })
    }
  }
  return chunks
}
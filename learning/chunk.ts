import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

export const MAX_TOKENS = 500 // split sections bigger than this
export const MIN_TOKENS = 100 // sections smaller than this get merged forward
export const estimateTokens = (t: string) => Math.ceil(t.length / 4)
export const componentsSeen = new Set<string>()

export interface Chunk {
  id: string
  title: string
  headingPath: string[]
  url: string
  filePath: string
  content: string // cleaned body, shown in citations
  text: string // heading path + content, this is what gets embedded
  tokens: number
}

interface Section { path: string[]; anchor?: string; text: string; tokens: number }

const isFence = (l: string) => /^\s*```/.test(l)
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

// Cleans one line of MDX. Only called on lines OUTSIDE code fences.
function cleanLine(line: string): string {
  let l = line.replace(/\{\/\*.*?\*\/\}/g, '') // {/* comments */}
  const adm = l.trim().match(/^<Admonition type="(\w+)"[^>]*>$/)
  if (adm) {
    componentsSeen.add('Admonition')
    return `${adm[1].toUpperCase()}:` // keep the warning text, label it
  }
  l = l.replace(/<\/?([A-Z][A-Za-z0-9]*)[^>]*>/g, (_m, name) => {
    componentsSeen.add(name)
    return ''
  })
  l = l.replace(/\[([^\]]+)\]\(<[^>]*>\)/g, '$1') // [text](<url>)
  l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url)
  return l
}

function toSections(body: string, title: string): Section[] {
  const raw: { path: string[]; anchor?: string; lines: string[] }[] = [{ path: [title], lines: [] }]
  const stack: string[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    const cur = raw[raw.length - 1]
    if (isFence(line)) { inFence = !inFence; cur.lines.push(line); continue }
    if (inFence) { cur.lines.push(line); continue }
    const h = line.match(/^(#{2,4})\s+(.+?)\s*$/)
    if (h) {
      const level = h[1].length - 2
      const text = cleanLine(h[2])
      stack.length = level
      stack[level] = text
      raw.push({ path: [title, ...stack.filter(Boolean)], anchor: slugify(text), lines: [`${h[1]} ${text}`] })
      continue
    }
    cur.lines.push(cleanLine(line))
  }
  return raw
    .map((s) => { const text = s.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(); return { path: s.path, anchor: s.anchor, text, tokens: estimateTokens(text) } })
    .filter((s) => s.text.length > 0)
}

// Tiny sections get merged into the next one; the merged chunk keeps the
// heading of whichever part holds more text.
function mergeTiny(sections: Section[]): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const next of sections) {
    if (cur && cur.tokens < MIN_TOKENS && cur.tokens + next.tokens <= MAX_TOKENS) {
      const keep = next.tokens >= cur.tokens ? next : cur
      const text = cur.text + '\n\n' + next.text
      cur = { path: keep.path, anchor: keep.anchor, text, tokens: estimateTokens(text) }
    } else {
      if (cur) out.push(cur)
      cur = next
    }
  }
  if (cur) out.push(cur)
  return out
}

// Splits on blank lines, but never inside a code fence.
function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (isFence(line)) inFence = !inFence
    if (!inFence && line.trim() === '') {
      if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
    } else cur.push(line)
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

function splitOversized(text: string): string[] {
  const pieces: string[] = []
  let cur = ''
  for (const block of splitBlocks(text)) {
    if (cur && estimateTokens(cur + '\n\n' + block) > MAX_TOKENS) { pieces.push(cur); cur = block }
    else cur = cur ? cur + '\n\n' + block : block
  }
  if (cur) pieces.push(cur)
  return pieces
}

export function chunkFile(filePath: string, guidesRoot: string): Chunk[] {
  const { data, content } = matter(fs.readFileSync(filePath, 'utf8'))
  const rel = path.relative(guidesRoot, filePath).replace(/\\/g, '/').replace(/\.mdx$/, '')
  const title = String(data.title ?? path.basename(rel))
  const pageUrl = `https://supabase.com/docs/guides/${rel}`

  const chunks: Chunk[] = []
  for (const section of mergeTiny(toSections(content, title))) {
    for (const piece of section.tokens > MAX_TOKENS ? splitOversized(section.text) : [section.text]) {
      chunks.push({
        id: `${rel}::${chunks.length}`,
        title,
        headingPath: section.path,
        url: section.anchor ? `${pageUrl}#${section.anchor}` : pageUrl,
        filePath: rel,
        content: piece,
        text: `${section.path.join(' > ')}\n\n${piece}`,
        tokens: estimateTokens(piece),
      })
    }
  }
  return chunks
}
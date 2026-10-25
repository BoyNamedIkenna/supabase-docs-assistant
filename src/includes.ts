import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { nextFence, type Fence } from './sections.js'

export interface IncludeContext {
  partialsRoot: string // e.g. source/apps/docs/content/_partials
  examplesRoot: string // e.g. source/examples
}

export const includeStats = {
  partials: 0,
  codeSamples: 0,
  missing: new Map<string, number>(), // file we could not find -> how many times
}
const miss = (what: string) => includeStats.missing.set(what, (includeStats.missing.get(what) ?? 0) + 1)

const INCLUDE_TAG = /^\s*<\$(Partial|CodeSample)\b/
const MAX_DEPTH = 5 // partials can include partials; stop runaway loops

const LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', sql: 'sql', py: 'python', json: 'json',
  kt: 'kotlin', swift: 'swift', dart: 'dart', sh: 'bash', cs: 'csharp', html: 'html',
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]
}

// variables={{ "framework": "exporeactnative", "tab": "mobiles" }}  ->  { framework: ..., tab: ... }
function parseVariables(tag: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const m = tag.match(/variables=\{\{([\s\S]*?)\}\}/)
  if (m) for (const kv of m[1].matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']*)["']/g)) vars[kv[1]] = kv[2]
  return vars
}

function resolvePartial(tag: string, ctx: IncludeContext, depth: number): string {
  const rel = attr(tag, 'path')
  if (!rel) return tag
  const file = path.join(ctx.partialsRoot, rel)
  if (!fs.existsSync(file)) { miss(`partial: ${rel}`); return tag }

  const vars = parseVariables(tag)
  const text = matter(fs.readFileSync(file, 'utf8')).content.replace(
    /\{\{\s*\.(\w+)\s*\}\}/g,
    (whole, key) => vars[key] ?? whole, // unknown placeholder stays, and the report flags it
  )
  includeStats.partials++
  return depth < MAX_DEPTH ? resolveIncludes(text, ctx, depth + 1) : text
}

function resolveCodeSample(tag: string, ctx: IncludeContext): string {
  const rel = attr(tag, 'path')
  if (!rel) return tag
  const file = path.join(ctx.examplesRoot, rel)
  if (!fs.existsSync(file)) { miss(`code sample: ${rel}`); return tag }

  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')

  // lines={[[1, -1]]}: 1-based ranges, a negative end counts from the last line
  let ranges: number[][] = [[1, -1]]
  const lm = tag.match(/lines=\{(\[[\s\S]*?\])\}/)
  if (lm) { try { ranges = JSON.parse(lm[1]) } catch { /* keep the whole file */ } }
  const pieces = ranges.map(([a, b]) => src.slice(Math.max(a, 1) - 1, b < 0 ? src.length + b + 1 : b).join('\n'))
  const code = pieces.join('\n...\n')

  const name = attr(tag, 'meta')?.match(/name=([^\s"]+)/)?.[1] ?? path.basename(rel)
  const lang = LANG[path.extname(rel).slice(1)] ?? ''
  const fence = code.includes('```') ? '````' : '```'
  includeStats.codeSamples++
  return `${name}\n\n${fence}${lang}\n${code}\n${fence}`
}

// Replaces <$Partial .../> and <$CodeSample .../> tags with the content they point to,
// the way the live docs site does. Tags inside code blocks are left alone.
// A tag we cannot resolve stays in place and is counted in includeStats.missing.
export function resolveIncludes(content: string, ctx: IncludeContext, depth = 0): string {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let fence: Fence = null

  for (let i = 0; i < lines.length; i++) {
    const wasOutside = fence === null
    fence = nextFence(fence, lines[i])
    if (!(wasOutside && fence === null) || !INCLUDE_TAG.test(lines[i])) {
      out.push(lines[i])
      continue
    }
    let tag = lines[i]
    let taken = 0
    while (!tag.includes('/>') && i + 1 < lines.length && taken < 20) { // a tag can span several lines
      i++
      taken++
      tag += '\n' + lines[i]
    }
    const kind = tag.match(INCLUDE_TAG)![1]
    out.push(kind === 'Partial' ? resolvePartial(tag, ctx, depth) : resolveCodeSample(tag, ctx))
  }
  return out.join('\n')
}
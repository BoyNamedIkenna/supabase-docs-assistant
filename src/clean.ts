import { nextFence, type Fence } from './sections'

export const componentsSeen = new Set<string>()
export const componentCounts = new Map<string, number>()
const seen = (name: string) => {
  componentsSeen.add(name)
  componentCounts.set(name, (componentCounts.get(name) ?? 0) + 1)
}

// Component names like Tabs, TabPanel, StepHikeCompact.Step, $Show, $Partial
const NAME = '\\$?[A-Z][A-Za-z0-9]*(?:\\.[A-Z][A-Za-z0-9]*)*'

const COMMENT = /\{\/\*.*?\*\/\}/g
const ADMONITION_OPEN = /^\s*<Admonition\s+type="(\w+)"[^>]*>\s*$/
const WHOLE_LINE_TAG = new RegExp(`^\\s*<\\/?(${NAME})\\b[^>]*>\\s*$`)
const TAG_START = new RegExp(`^\\s*<(${NAME})\\b`)
const INLINE_TAG = new RegExp(`<\\/?(${NAME})\\b[^>]*>`, 'g')
const SHOW_CLOSE = /^\s*<\/\$Show>\s*$/
const MAX_TAG_LINES = 30 // safety: give up on a "multi-line tag" that never closes

// Text worth keeping from a tag's attributes:
//   <$Show if="sdk:dart">  ->  [sdk:dart]
//   <TabPanel label="JavaScript"> / <Step title="Create a table">  ->  the label / title
function tagText(tag: string): string {
  const show = tag.match(/<\$Show\s[^>]*\bif="([^"]+)"/)
  if (show) return `[${show[1]}]`
  const m = tag.match(/\b(?:title|label)="([^"]+)"/)
  return m ? m[1] : ''
}

// Cleans ONE line of prose. Never call this on a line inside a code block.
export function cleanLine(line: string): string {
  let l = line.replace(COMMENT, '')

  const adm = l.match(ADMONITION_OPEN)
  if (adm) {
    seen('Admonition')
    return `${adm[1].toUpperCase()}:`
  }

  if (SHOW_CLOSE.test(l)) {
    seen('$Show')
    return '[end]'
  }

  const tag = l.match(WHOLE_LINE_TAG)
  if (tag) {
    seen(tag[1])
    return tagText(l)
  }

  l = l.replace(/\[([^\]]+)\]\(<[^>]*>\)/g, '$1') // [text](<url>)
  l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url)

  // Inline components in a sentence: drop the tag, keep the text inside it.
  // Anything between backticks is left alone, so `Database<Foo>` survives.
  l = l
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(INLINE_TAG, (_m, name) => {
            seen(name)
            return ''
          }),
    )
    .join('')
  return l
}

// True if nothing but blanks and component tags follows line i of this section.
// A label with nothing after it belongs to the NEXT section, so we drop it here.
function nothingFollows(lines: string[], i: number): boolean {
  return lines.slice(i + 1).every((l) => l.trim() === '' || WHOLE_LINE_TAG.test(l))
}

// Cleans a section's lines. Code blocks are left untouched, and a tag whose
// attributes run over several lines (<Tabs ... > on 5 lines) is removed as one unit.
export function cleanSectionLines(lines: string[]): string[] {
  let fence: Fence = null
  let pending: string[] | null = null // lines of a multi-line tag we're collecting
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const wasOutside = fence === null
    fence = nextFence(fence, line)
    if (!(wasOutside && fence === null)) {
      out.push(line) // inside a code block (or a fence line)
      continue
    }

    if (pending !== null) {
      pending.push(line)
      if (line.includes('>')) {
        const tagSource = pending.join(' ')
        seen(tagSource.match(TAG_START)?.[1] ?? 'unknown')
        out.push(nothingFollows(lines, i) ? '' : tagText(tagSource))
        pending = null
      } else if (pending.length > MAX_TAG_LINES) {
        out.push(...pending.map(cleanLine)) // never closed: treat as ordinary text
        pending = null
      }
      continue
    }

    if (TAG_START.test(line) && !line.includes('>')) {
      pending = [line.trim()] // a tag opens here and closes on a later line
      continue
    }

    const cleaned = cleanLine(line)
    const isTagLine = WHOLE_LINE_TAG.test(line) && !ADMONITION_OPEN.test(line)
    out.push(isTagLine && cleaned !== '' && nothingFollows(lines, i) ? '' : cleaned)
  }

  if (pending) out.push(...pending.map(cleanLine))
  return out
}

// Removes multi-line MDX comments ({/* ... */} spanning several lines) from a whole
// page BEFORE it is split into sections, so hidden text and commented-out headings
// never reach the index. Comment markers inside code blocks are left alone.
export function stripMdxComments(content: string): string {
  let fence: Fence = null
  let inComment = false
  const out: string[] = []

  for (const line of content.split(/\r?\n/)) {
    if (inComment) {
      const end = line.indexOf('*/}')
      if (end === -1) continue // still inside the comment: drop the line
      inComment = false
      const rest = line.slice(end + 3)
      if (rest.trim() !== '') out.push(rest)
      continue
    }

    const wasOutside = fence === null
    fence = nextFence(fence, line)
    if (!(wasOutside && fence === null)) {
      out.push(line) // code block or fence line
      continue
    }

    const start = line.indexOf('{/*')
    if (start !== -1 && line.indexOf('*/}', start) === -1) {
      inComment = true
      const before = line.slice(0, start)
      if (before.trim() !== '') out.push(before)
      continue
    }
    out.push(line)
  }

  // A comment that never closes would swallow the rest of the page: leave the page as is.
  return inComment ? content : out.join('\n')
}
export type Section = { heading: string; level: number; title: string; lines: string[] }
export type Fence = { char: string; len: number } | null

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/

// Given the fence we're currently inside (or null) and the next line,
// returns the fence we're inside after reading that line.
export function nextFence(open: Fence, line: string): Fence {
  const m = line.match(FENCE)
  if (!m) return open
  const char = m[1][0]
  const len = m[1].length
  const rest = m[2].trim()
  if (open === null) return { char, len } // opens a block
  if (char === open.char && len >= open.len && rest === '') return null // closes it
  return open // fence-looking line inside a block: just content
}

export function splitSections(content: string, trackFences: boolean): Section[] {
  const sections: Section[] = [{ heading: '(intro)', level: 0, title: '(intro)', lines: [] }]
  let fence: Fence = null

  for (const line of content.split(/\r?\n/)) {
    fence = trackFences ? nextFence(fence, line) : null
    const match = fence === null && line.match(/^(#{2,3})\s+(.+)$/)
    if (match) {
      sections.push({
        heading: `${match[1]} ${match[2]}`,
        level: match[1].length, // 2 for ##, 3 for ###
        title: match[2],
        lines: [],
      })
    } else {
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections
}
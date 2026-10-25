import fs from 'node:fs'
import matter from 'gray-matter'

type Section = { heading: string; lines: string[] }

function splitSections(content: string, trackFences: boolean): Section[] {
  const sections: Section[] = [{ heading: '(intro)', lines: [] }]
  let inFence = false

  for (const line of content.split(/\r?\n/)) {
    if (trackFences && /^\s*```/.test(line)) inFence = !inFence

    const match = !inFence && line.match(/^(#{2,3})\s+(.+)$/)
    if (match) {
      sections.push({ heading: `${match[1]} ${match[2]}`, lines: [] })
    } else {
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections
}

function show(label: string, sections: Section[]) {
  console.log(label)
  for (const s of sections) {
    const text = s.lines.join('\n').trim()
    console.log(`  ${String(Math.ceil(text.length / 4)).padStart(4)} tokens  ${s.heading}`)
  }
  console.log()
}

// A small made-up page where a code block contains a line starting with ##
const tricky = [
  '## Real heading',
  'Some text.',
  '```bash',
  '## this is a comment inside a code block',
  'npm install',
  '```',
  '## Another real heading',
  'More text.',
].join('\n')

show('Tricky text, WITHOUT fence tracking:', splitSections(tricky, false))
show('Tricky text, WITH fence tracking:', splitSections(tricky, true))

const filePath =
  'source/apps/docs/content/guides/database/postgres/row-level-security-performance.mdx'
const { content } = matter(fs.readFileSync(filePath, 'utf8'))
show('Real file, WITH fence tracking:', splitSections(content, true))
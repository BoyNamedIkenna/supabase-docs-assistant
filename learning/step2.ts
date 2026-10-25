import fs from 'node:fs'
import matter from 'gray-matter'

const filePath =
  'source/apps/docs/content/guides/database/postgres/row-level-security-performance.mdx'

const { content } = matter(fs.readFileSync(filePath, 'utf8'))

const sections: { heading: string; lines: string[] }[] = [{ heading: '(intro)', lines: [] }]

for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^(#{2,3})\s+(.+)$/)
  if (match) {
    sections.push({ heading: `${match[1]} ${match[2]}`, lines: [] })
  } else {
    sections[sections.length - 1].lines.push(line)
  }
}

for (const s of sections) {
  const text = s.lines.join('\n').trim()
  console.log(`${String(Math.ceil(text.length / 4)).padStart(5)} tokens  ${s.heading}`)
}
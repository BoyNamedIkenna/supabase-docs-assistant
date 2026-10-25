import fs from 'node:fs'
import matter from 'gray-matter'
import { splitSections } from '../src/sections.js'
import { cleanLine, cleanSectionLines, componentsSeen } from '../src/clean.js'

const tests = [
  '{/* prettier-ignore */}',
  '<Admonition type="caution">',
  '</Admonition>',
  'See [Row Level Security](/docs/guides/database/postgres/row-level-security).',
  'a "[defense in depth](<https://en.wikipedia.org/wiki/Defense_in_depth_(computing)>)" link',
  '- [Call functions with `select`](/docs/guides/x#call-functions-with-select)',
  'Pass `Database<Foo>` as the type.',
]
for (const t of tests) console.log(JSON.stringify(t) + '\n   -> ' + JSON.stringify(cleanLine(t)))

const filePath =
  'source/apps/docs/content/guides/database/postgres/row-level-security-performance.mdx'
const { content } = matter(fs.readFileSync(filePath, 'utf8'))
const section = splitSections(content, true).find((s) => s.heading.startsWith('## Diagnose'))!

console.log('\n===== BEFORE =====')
console.log(section.lines.join('\n').trim())
console.log('\n===== AFTER =====')
console.log(cleanSectionLines(section.lines).join('\n').replace(/\n{3,}/g, '\n\n').trim())
console.log('\ncomponents seen:', [...componentsSeen])
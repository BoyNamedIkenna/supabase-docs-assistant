import fs from 'node:fs'
import matter from 'gray-matter'

const filePath =
  'source/apps/docs/content/guides/database/postgres/row-level-security-performance.mdx'

const raw = fs.readFileSync(filePath, 'utf8')   // the whole file as one string
const { data, content } = matter(raw)           // split it into metadata + body

console.log('Frontmatter:', data)
console.log('Body length (characters):', content.length)
console.log('Estimated tokens:', Math.ceil(content.length / 4))
console.log('--- first 300 characters of the body ---')
console.log(content.slice(0, 300))
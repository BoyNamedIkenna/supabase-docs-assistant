import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { splitSections } from '../src/sections.js'

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return full.endsWith('.mdx') ? [full] : []
  })
}

const root = 'source/apps/docs/content/guides'
const files = ['auth', 'database'].flatMap((folder) => walk(path.join(root, folder)))

let filesAffected = 0
for (const file of files) {
  const { content } = matter(fs.readFileSync(file, 'utf8'))
  const without = splitSections(content, false).map((s) => s.heading)
  const withFences = splitSections(content, true).map((s) => s.heading)

  if (without.length !== withFences.length) {
    filesAffected++
    console.log(path.relative(root, file))
    const real = new Set(withFences)
    without.filter((h) => !real.has(h)).forEach((h) => console.log('   fake heading:', h))
  }
}

console.log(`\nChecked ${files.length} files. Files with fake headings: ${filesAffected}`)
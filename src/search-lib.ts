export interface Match {
  id: string
  title: string
  heading_path: string[]
  url: string
  content: string
  similarity?: number // vector-only search
  score?: number // hybrid search (rank-fusion score, only meaningful for ordering)
}

// Shared partials put the same text on many pages, so one search can return several
// identical chunks. Keep the best-ranked copy of each and return the first n.
export function dedupe(rows: Match[], n: number): Match[] {
  const seen = new Set<string>()
  const out: Match[] = []
  for (const r of rows) {
    const key = r.content.replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length === n) break
  }
  return out
}

// A chunk id looks like 'auth/auth-anonymous::3'. The part before :: is the page.
export const fileOf = (id: string) => id.split('::')[0]
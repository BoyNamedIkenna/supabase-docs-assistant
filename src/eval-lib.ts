import { fileOf, type Match } from './search-lib'

// vector: vector search only. vrerank: vector search, then the model re-ranks (what the app does).
export type Mode = 'vector' | 'vrerank'
export const MODES: Mode[] = ['vector', 'vrerank']
export const MODE_LABEL: Record<Mode, string> = {
  vector: 'vector',
  vrerank: 'vector+rerank',
}

export interface Case { question: string; expect: string[] }
export interface CaseResult {
  question: string
  expect: string[]
  ranks: Record<Mode, number | null> // position of the first correct page among the sources the model would see
  pages: Record<Mode, string[]> // the pages those sources come from, best first
}

// Accepts 'auth/auth-anonymous', '/guides/auth/auth-anonymous', or a full docs URL (with or
// without #anchor), and returns the page id as stored in the index: 'auth/auth-anonymous'.
export const normalizePage = (s: string) =>
  s.trim().replace(/^(?:https?:\/\/[^/]+)?\/?(?:docs\/)?(?:guides\/)?/, '').replace(/#.*$/, '').replace(/\/$/, '')

// Separates questions we can score from those whose expected pages are not in the index at all
// (a page outside the folders we indexed, or a mistyped id). Those would "fail" whatever search does.
export function splitByIndex(cases: Case[], indexed: Set<string>) {
  const scored: Case[] = []
  const skipped: string[] = []
  const missingPages = new Map<string, string[]>() // page -> questions that expect it
  for (const c of cases) {
    const pages = c.expect.map(normalizePage)
    for (const p of pages.filter((p) => !indexed.has(p))) missingPages.set(p, [...(missingPages.get(p) ?? []), c.question])
    const present = pages.filter((p) => indexed.has(p))
    if (present.length === 0) skipped.push(c.question)
    else scored.push({ question: c.question, expect: present })
  }
  return { scored, skipped, missingPages }
}

// 1-based position of the first result whose page is one of the acceptable pages, or null for a miss.
export function rankOfFirstHit(files: string[], expect: string[]): number | null {
  const ok = new Set(expect.map(normalizePage))
  const i = files.findIndex((f) => ok.has(f))
  return i === -1 ? null : i + 1
}

export function summarize(ranks: (number | null)[]) {
  const n = ranks.length
  const within = (k: number) => ranks.filter((r) => r !== null && r <= k).length
  const mrr = n === 0 ? 0 : ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / n
  return { n, found: ranks.filter((r) => r !== null).length, top1: within(1), top3: within(3), mrr }
}

export function movement(results: CaseResult[], from: Mode, to: Mode) {
  const gained = results.filter((r) => r.ranks[from] === null && r.ranks[to] !== null).map((r) => r.question)
  const lost = results.filter((r) => r.ranks[from] !== null && r.ranks[to] === null).map((r) => r.question)
  return { gained, lost }
}

// ['a','a','a','b'] -> 'a (x3), b'  so five chunks from one page read as one entry
export function compact(files: string[]): string {
  const out: string[] = []
  for (const f of files) {
    const last = out[out.length - 1]
    const m = last?.match(/^(.*) \(x(\d+)\)$/)
    if (last === f) out[out.length - 1] = `${f} (x2)`
    else if (m && m[1] === f) out[out.length - 1] = `${f} (x${Number(m[2]) + 1})`
    else out.push(f)
  }
  return out.join(', ')
}

export async function evaluate(
  cases: Case[],
  sourcesFor: (question: string, mode: Mode) => Promise<Match[]>,
): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  for (const c of cases) {
    const ranks = {} as Record<Mode, number | null>
    const pages = {} as Record<Mode, string[]>
    for (const mode of MODES) {
      const files = (await sourcesFor(c.question, mode)).map((m) => fileOf(m.id))
      pages[mode] = files
      ranks[mode] = rankOfFirstHit(files, c.expect)
    }
    results.push({ question: c.question, expect: c.expect.map(normalizePage), ranks, pages })
  }
  return results
}
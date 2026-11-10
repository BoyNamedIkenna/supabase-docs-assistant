import type { Match } from './search-lib'

export interface Ranked { match: Match; from: number } // from = 1-based position before re-ranking

export const RERANK_SYSTEM = `You rank documentation excerpts by how useful they are for answering a user's question.
You are given numbered excerpts. Reply with ONLY a JSON array of excerpt numbers, best first, for example [4, 1, 9].
- Prefer excerpts that explain how to fix or do the thing over excerpts that only mention it in passing.
- Leave out excerpts that are unrelated to the question.
- Return at most the number of excerpts you are asked for.`

export function buildRerankPrompt(question: string, candidates: Match[], k: number): string {
  const lines = candidates.map((c, i) => {
    const excerpt = c.content.replace(/\s+/g, ' ').trim().slice(0, 400)
    return `[${i + 1}] ${c.heading_path.join(' > ')}\n${excerpt}`
  })
  return `Question: ${question}\n\nReturn the numbers of the ${k} most useful excerpts, best first.\n\nExcerpts:\n\n${lines.join('\n\n')}`
}

// Pulls excerpt numbers out of the model's reply. Prefers a [...] array; ignores numbers out of range and repeats.
export function parseRanking(text: string, count: number): number[] {
  const source = text.match(/\[[^\]]*\]/)?.[0] ?? text
  const seen = new Set<number>()
  const out: number[] = []
  for (const m of source.matchAll(/\d+/g)) {
    const n = Number(m[0])
    if (n >= 1 && n <= count && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

const MIN_KEEP = 4 // never hand the answering model fewer than this

// Re-orders candidates using the model's ranking. If the reply is empty or unusable, or the call fails,
// falls back to the original order: re-ranking must never make things worse than not re-ranking.
export async function rerank(
  question: string,
  candidates: Match[],
  k: number,
  complete: (system: string, user: string) => Promise<string>,
): Promise<{ ranked: Ranked[]; fallback: string | null }> {
  const original = (): Ranked[] => candidates.slice(0, k).map((match, i) => ({ match, from: i + 1 }))
  if (candidates.length <= k) return { ranked: original(), fallback: null }

  let reply: string
  try {
    reply = await complete(RERANK_SYSTEM, buildRerankPrompt(question, candidates, k))
  } catch (e) {
    return { ranked: original(), fallback: `re-ranking call failed: ${(e as Error).message}` }
  }

  const order = parseRanking(reply, candidates.length)
  if (order.length === 0) return { ranked: original(), fallback: 'could not read the re-ranking reply' }

  const chosen = order.slice(0, k)
  for (let n = 1; chosen.length < Math.min(MIN_KEEP, k) && n <= candidates.length; n++) {
    if (!chosen.includes(n)) chosen.push(n) // top up from the original order
  }
  return { ranked: chosen.map((n) => ({ match: candidates[n - 1], from: n })), fallback: null }
}
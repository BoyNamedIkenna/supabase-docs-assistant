import { dedupe, capPerPage, type Match } from './search-lib'
import { SYSTEM_PROMPT, buildPrompt, citedNumbers, isNotFound, tidyAnswer } from './ask-lib'
import { rerank, type Ranked } from './rerank-lib'

export const CANDIDATES = 30
export const SOURCES = 8
export const MAX_PER_PAGE = 3
const RERANK_POOL = SOURCES + 4 // extra picks, so the per-page cap still leaves SOURCES
const MIN_SOURCES = 4 // same floor as MIN_KEEP in rerank-lib

export interface Deps {
  embed: (text: string) => Promise<number[]>
  search: (question: string, embedding: number[], count: number) => Promise<Match[]>
  complete: (system: string, user: string, role: 'answer' | 'rerank') => Promise<string>
  useRerank: boolean
  ping?: () => Promise<void>
}

export interface SourceInfo {
  number: number
  headingPath: string[]
  url: string
  cited: boolean
}

export interface AnswerResult {
  notFound: boolean
  answer: string
  sources: SourceInfo[]
  meta: {
    candidates: number
    rerankFallback: string | null
    considered: { headingPath: string[]; from: number }[]
  }
}

// The evaluation script calls this same function, so the test measures what the app really does.
export async function retrieve(
  question: string,
  deps: Deps,
): Promise<{ candidates: Match[]; ranked: Ranked[]; fallback: string | null }> {
  const embedding = await deps.embed(question)
  const rows = await deps.search(question, embedding, CANDIDATES * 2) // twice as many, so removing duplicates still leaves enough
  const candidates = dedupe(rows, CANDIDATES)

  const picked = deps.useRerank
    ? await rerank(question, candidates, RERANK_POOL, (system, user) => deps.complete(system, user, 'rerank'))
    : { ranked: candidates.map((match, i) => ({ match, from: i + 1 })), fallback: null }

  let ranked = capPerPage(picked.ranked, MAX_PER_PAGE, SOURCES)
  if (ranked.length < MIN_SOURCES) {
    const have = new Set(ranked.map((r) => r.match.id))
    const extra = candidates.map((match, i) => ({ match, from: i + 1 })).filter((r) => !have.has(r.match.id))
    ranked = capPerPage([...ranked, ...extra], MAX_PER_PAGE, MIN_SOURCES)
  }
  return { candidates, ranked, fallback: picked.fallback }
}

export async function answerQuestion(question: string, deps: Deps): Promise<AnswerResult> {
  const { candidates, ranked, fallback } = await retrieve(question, deps)
  const used = ranked.map((r) => r.match)
  const meta = {
    candidates: candidates.length,
    rerankFallback: fallback,
    considered: ranked.map((r) => ({ headingPath: r.match.heading_path, from: r.from })),
  }
  if (used.length === 0) return { notFound: true, answer: '', sources: [], meta } // nothing retrieved: don't ask the model

  const answer = tidyAnswer(await deps.complete(SYSTEM_PROMPT, buildPrompt(question, used), 'answer'))
  if (isNotFound(answer)) return { notFound: true, answer: '', sources: [], meta }

  const cited = new Set(citedNumbers(answer, used.length))
  const sources = used.map((s, i) => ({ number: i + 1, headingPath: s.heading_path, url: s.url, cited: cited.has(i + 1) }))
  return { notFound: false, answer, sources, meta }
}
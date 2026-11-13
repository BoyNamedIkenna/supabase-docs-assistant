import { dedupe, type Match } from './search-lib'
import { SYSTEM_PROMPT, buildPrompt, citedNumbers, isNotFound, tidyAnswer } from './ask-lib'
import { rerank } from './rerank-lib'

export const CANDIDATES = 30 // how many chunks we retrieve
export const SOURCES = 8 // how many of them the answering model sees, after re-ranking

// Everything that touches the outside world is passed in, so the logic below can be tested offline.
export interface Deps {
  embed: (text: string) => Promise<number[]>
  search: (question: string, embedding: number[], count: number) => Promise<Match[]>
  complete: (system: string, user: string, role: 'answer' | 'rerank') => Promise<string>
  useRerank: boolean
  ping?: () => Promise<void> // a cheap database query, used by the deep health check
}

export interface SourceInfo {
  number: number // matches the [1], [2] markers in the answer text
  headingPath: string[]
  url: string
  cited: boolean // true if the answer actually refers to this source
}

export interface AnswerResult {
  notFound: boolean
  answer: string // Markdown, with [1]-style citations. Empty when notFound.
  sources: SourceInfo[]
  meta: {
    candidates: number
    rerankFallback: string | null
    considered: { headingPath: string[]; from: number }[] // what the model saw, and each chunk's rank before re-ranking
  }
}

export async function answerQuestion(question: string, deps: Deps): Promise<AnswerResult> {
  // 1. Retrieve a wide pool
  const embedding = await deps.embed(question)
  const rows = await deps.search(question, embedding, CANDIDATES * 2) // twice as many, so removing duplicates still leaves enough
  const candidates = dedupe(rows, CANDIDATES)

  // 2. Re-rank (or just take the top ones)
  const { ranked, fallback } = deps.useRerank
    ? await rerank(question, candidates, SOURCES, (system, user) => deps.complete(system, user, 'rerank'))
    : { ranked: candidates.slice(0, SOURCES).map((match, i) => ({ match, from: i + 1 })), fallback: null }
  const used = ranked.map((r) => r.match)
  const meta = {
    candidates: candidates.length,
    rerankFallback: fallback,
    considered: ranked.map((r) => ({ headingPath: r.match.heading_path, from: r.from })),
  }
  if (used.length === 0) return { notFound: true, answer: '', sources: [], meta } // nothing retrieved: don't ask the model

  // 3. Answer from those sources only
  const answer = tidyAnswer(await deps.complete(SYSTEM_PROMPT, buildPrompt(question, used), 'answer'))
  if (isNotFound(answer)) return { notFound: true, answer: '', sources: [], meta }

  const cited = new Set(citedNumbers(answer, used.length))
  const sources = used.map((s, i) => ({ number: i + 1, headingPath: s.heading_path, url: s.url, cited: cited.has(i + 1) }))
  return { notFound: false, answer, sources, meta }
}
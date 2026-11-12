// The shape of the reply from POST /api/ask
export interface SourceInfo {
  number: number // matches the [1], [2] markers in the answer text
  headingPath: string[]
  url: string
  cited: boolean // true if the answer actually refers to this source
}

export interface AnswerResult {
  notFound: boolean
  answer: string // Markdown with [1]-style citations. Empty when notFound.
  sources: SourceInfo[]
}
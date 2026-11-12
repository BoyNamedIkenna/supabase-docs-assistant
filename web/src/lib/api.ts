import type { AnswerResult } from '../types'

// In development, Vite forwards /api to the Express server. When deployed, set VITE_API_URL to the server's address.
const BASE = import.meta.env.VITE_API_URL ?? ''

export async function askQuestion(question: string, signal: AbortSignal): Promise<AnswerResult> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    })
  } catch (e) {
    if (signal.aborted) throw e // the visitor asked something else: not an error to show
    throw new Error("Couldn't reach the server. Is it running?")
  }

  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `The server answered with an error (${res.status}).`)
  return body as AnswerResult
}
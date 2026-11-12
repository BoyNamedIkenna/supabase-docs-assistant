import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LoaderCircle, Search, TriangleAlert } from 'lucide-react'
import { askQuestion } from './lib/api'
import type { AnswerResult } from './types'
import AnswerView from './components/AnswerView'
import Sources from './components/Sources'

const EXAMPLES = [
  'How do I sign users in anonymously?',
  'Why is my RLS policy slow?',
  'How do I send a magic link login email?',
]

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; question: string }
  | { kind: 'done'; question: string; result: AnswerResult }
  | { kind: 'error'; question: string; message: string }

export default function App() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)

  async function ask(raw: string) {
    const question = raw.trim()
    if (!question) return
    controller.current?.abort() // a newer question replaces an unfinished one
    const ctl = new AbortController()
    controller.current = ctl
    setState({ kind: 'loading', question })
    try {
      const result = await askQuestion(question, ctl.signal)
      setState({ kind: 'done', question, result })
    } catch (e) {
      if (ctl.signal.aborted) return
      setState({ kind: 'error', question, message: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  const loading = state.kind === 'loading'

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Supabase Docs Assistant</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Ask about Supabase Auth and Database. Answers come only from the official docs, with links to the sections they
            used.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex gap-2">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <input
            id="question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="e.g. How do I let users read only their own rows?"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            Ask
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setInput(ex)
                void ask(ex)
              }}
              className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-emerald-300"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-10" aria-live="polite">
          {state.kind === 'loading' && (
            <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Searching the docs…
            </p>
          )}

          {state.kind === 'error' && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> {state.message}
            </p>
          )}

          {state.kind === 'done' && state.result.notFound && (
            <div className="rounded-lg border border-slate-200 p-5 dark:border-slate-700">
              <p className="font-medium">I couldn’t find that in the Supabase Auth and Database docs.</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                This assistant only covers those two sections and won’t guess. Try rephrasing, or search the full docs at{' '}
                <a className="underline" href="https://supabase.com/docs" target="_blank" rel="noreferrer noopener">
                  supabase.com/docs
                </a>
                .
              </p>
            </div>
          )}

          {state.kind === 'done' && !state.result.notFound && (
            <>
              <AnswerView answer={state.result.answer} sources={state.result.sources} />
              <Sources sources={state.result.sources} />
              <p className="mt-8 rounded-lg bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                This answer was generated by an AI model from the official Supabase docs and can be wrong. Check the linked
                sources before relying on it.
              </p>
            </>
          )}
        </div>

        <footer className="mt-16 border-t border-slate-200 pt-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-500">
          Hybrid vector and keyword search, re-ranking, and cited answers. Not affiliated with Supabase.
        </footer>
      </main>
    </div>
  )
}
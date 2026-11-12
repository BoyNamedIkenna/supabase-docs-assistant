import { useMemo } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkCitations } from '../lib/citations'
import type { SourceInfo } from '../types'

const isCitation = (children: ReactNode) => /^\[\d+\]$/.test(String(children))

export default function AnswerView({ answer, sources }: { answer: string; sources: SourceInfo[] }) {
  const plugins = useMemo(
    () => [remarkGfm, remarkCitations((n) => sources.find((s) => s.number === n)?.url)],
    [sources],
  )

  return (
    <div className="prose prose-slate max-w-none dark:prose-invert prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-slate-200/70 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal dark:prose-code:bg-slate-700/60 prose-pre:prose-code:bg-transparent prose-pre:prose-code:p-0">
      <Markdown
        remarkPlugins={plugins}
        components={{
          a: ({ href, children }) =>
            isCitation(children) ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                title="Open this source in the Supabase docs"
                className="mx-0.5 inline-block rounded bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-800 no-underline hover:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-200 dark:hover:bg-emerald-800/70"
              >
                {children}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
        }}
      >
        {answer}
      </Markdown>
    </div>
  )
}
import { ExternalLink } from 'lucide-react'
import type { SourceInfo } from '../types'

function Item({ s }: { s: SourceInfo }) {
  return (
    <li>
      <a
        href={s.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-700 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40"
      >
        <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-emerald-100 px-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
          {s.number}
        </span>
        <span className="flex-1 text-sm">{s.headingPath.join(' › ')}</span>
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden />
      </a>
    </li>
  )
}

export default function Sources({ sources }: { sources: SourceInfo[] }) {
  const used = sources.filter((s) => s.cited)
  const others = sources.filter((s) => !s.cited)

  return (
    <section className="mt-8" aria-label="Sources">
      {used.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sources used</h2>
          <ul className="space-y-2">
            {used.map((s) => (
              <Item key={s.number} s={s} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            Also considered ({others.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {others.map((s) => (
              <Item key={s.number} s={s} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
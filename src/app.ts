import express from 'express'
import cors from 'cors'
import { answerQuestion, type Deps } from './answer'
import { createLimiter } from './rate-limit'
import { describeError } from './embed-lib'

export const MAX_QUESTION_CHARS = 500

export function createApp(
  deps: Deps,
  opts: { allowedOrigin?: string; maxPerMinute?: number; now?: () => number; logError?: (msg: string) => void; dailyLimit?: number } = {},
) {
  const app = express()
  app.set('trust proxy', 1) // behind one proxy (like Render), so req.ip is the visitor's address
  app.use(cors({ origin: opts.allowedOrigin ?? 'http://localhost:5173' }))
  app.use(express.json({ limit: '10kb' }))

  const limiter = createLimiter({ max: opts.maxPerMinute ?? 10, windowMs: 60_000, now: opts.now })
  // A ceiling on total questions per day, across all visitors, so a flood from many addresses cannot run up the bill.
  // It lives in memory, so it also resets when the server restarts: your OpenAI spending limit is the real backstop.
  const daily = createLimiter({ max: opts.dailyLimit ?? 300, windowMs: 86_400_000, now: opts.now })
  const logError = opts.logError ?? console.error

  // /api/health is a plain "the server is up". /api/health?deep=1 also touches the database,
  // which a scheduled ping can use to keep a free Supabase project from being paused.
  app.get('/api/health', async (req, res) => {
    if (req.query.deep !== '1' || !deps.ping) {
      res.json({ ok: true })
      return
    }
    try {
      await deps.ping()
      res.json({ ok: true, db: true })
    } catch (e) {
      logError(`health check failed: ${describeError(e)}`)
      res.status(503).json({ ok: false, db: false })
    }
  })

  app.post('/api/ask', async (req, res) => {
    // Every question costs money, so limit how fast one visitor can ask.
    const limit = limiter.hit(req.ip ?? 'unknown')
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec))
      res.status(429).json({ error: `Too many questions. Please try again in ${limit.retryAfterSec} seconds.` })
      return
    }

    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    if (!question) {
      res.status(400).json({ error: 'Please type a question.' })
      return
    }
    if (question.length > MAX_QUESTION_CHARS) {
      res.status(400).json({ error: `Please keep your question under ${MAX_QUESTION_CHARS} characters.` })
      return
    }
    if (!daily.hit('all-visitors').allowed) {
      res.status(503).json({ error: 'This demo has reached its daily question limit. Please try again tomorrow.' })
      return
    }

    try {
      res.json(await answerQuestion(question, deps))
    } catch (e) {
      logError(`ask failed: ${describeError(e)}`) // details stay in the server log, not in the reply
      res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' })
    }
  })

  // Malformed JSON and similar: answer in JSON too
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status ?? 400
    res.status(status >= 400 && status < 500 ? status : 400).json({ error: 'That request could not be read.' })
  })

  return app
}
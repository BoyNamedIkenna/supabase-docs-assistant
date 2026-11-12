import express from 'express'
import cors from 'cors'
import { answerQuestion, type Deps } from './answer'
import { createLimiter } from './rate-limit'
import { describeError } from './embed-lib'

export const MAX_QUESTION_CHARS = 500

export function createApp(
  deps: Deps,
  opts: { allowedOrigin?: string; maxPerMinute?: number; now?: () => number; logError?: (msg: string) => void } = {},
) {
  const app = express()
  app.set('trust proxy', 1) // behind one proxy (like Render), so req.ip is the visitor's address
  app.use(cors({ origin: opts.allowedOrigin ?? 'http://localhost:5173' }))
  app.use(express.json({ limit: '10kb' }))

  const limiter = createLimiter({ max: opts.maxPerMinute ?? 10, windowMs: 60_000, now: opts.now })
  const logError = opts.logError ?? console.error

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
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
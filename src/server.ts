import 'dotenv/config'
import { createApp } from './app'
import { createDeps } from './clients'

const port = Number(process.env.PORT ?? 3001)
const app = createApp(createDeps(), {
    allowedOrigin: process.env.ALLOWED_ORIGIN,
    maxPerMinute: Number(process.env.MAX_PER_MINUTE) || undefined, // default 10 per visitor
    dailyLimit: Number(process.env.DAILY_LIMIT) || undefined, // default 300 questions per day in total
})
app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
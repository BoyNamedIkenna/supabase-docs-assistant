import 'dotenv/config'
import { createApp } from './app'
import { createDeps } from './clients'

const port = Number(process.env.PORT ?? 3001)
const app = createApp(createDeps(), { allowedOrigin: process.env.ALLOWED_ORIGIN })
app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
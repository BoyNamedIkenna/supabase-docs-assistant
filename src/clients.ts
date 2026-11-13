import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import type { Match } from './search-lib'
import type { Deps } from './answer'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

// The real connections: OpenAI for embeddings and answers, Supabase for search.
export function createDeps(): Deps {
  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY'), maxRetries: 5 })
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'))
  const chatModel = process.env.CHAT_MODEL ?? 'gpt-5.4-nano'
  const rerankModel = process.env.RERANK_MODEL ?? chatModel

  return {
    useRerank: process.env.RERANK !== 'off', // put RERANK=off in .env to skip the re-ranking step
    ping: async () => {
      const { error } = await supabase.from('doc_chunks').select('id').limit(1)
      if (error) throw new Error(error.message)
    },
    embed: async (text) => {
      const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text })
      return res.data[0].embedding
    },
    search: async (question, embedding, count) => {
      const { data, error } = await supabase.rpc('hybrid_match_chunks', {
        query_text: question,
        query_embedding: embedding,
        match_count: count,
      })
      if (error) throw new Error(`Search failed: ${error.message} ${error.details ?? ''}`.slice(0, 600))
      return data as Match[]
    },
    complete: async (system, user, role) => {
      const res = await openai.chat.completions.create({
        model: role === 'rerank' ? rerankModel : chatModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      return res.choices[0].message.content ?? ''
    },
  }
}
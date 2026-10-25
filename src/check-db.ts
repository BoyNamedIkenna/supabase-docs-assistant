import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
  const { count, error } = await supabase
    .from('doc_chunks')
    .select('*', { count: 'exact', head: true })

  if (error) console.error('Failed:', error.message)
  else console.log('Connected. Rows in doc_chunks:', count)
}

main()
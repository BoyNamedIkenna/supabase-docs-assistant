-- Run this in the Supabase SQL editor.
create extension if not exists vector with schema extensions;

create table if not exists doc_chunks (
  id text primary key,              -- e.g. 'auth/auth-anonymous::3'
  title text not null,
  heading_path text[] not null,
  url text not null,                -- deep link used for citations
  file_path text not null,
  content text not null,            -- the text shown as the source
  tokens int not null,
  embedding vector(1536),           -- text-embedding-3-small output size
  -- keyword index. Dots become word breaks, so "db_plan_enabled" and "uid"
  -- can find "pgrst.db_plan_enabled" and "auth.uid()".
);


-- Only the server's secret key should read this table.
alter table doc_chunks enable row level security;
revoke all on doc_chunks from anon, authenticated;

-- Vector-only search
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id text, title text, heading_path text[], url text, content text, similarity float)
language sql stable
as $$
  select c.id, c.title, c.heading_path, c.url, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from doc_chunks c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;


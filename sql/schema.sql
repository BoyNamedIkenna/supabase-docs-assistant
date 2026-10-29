create extension if not exists vector with schema extensions;

create table doc_chunks (
  id text primary key,              -- e.g. 'auth/auth-anonymous::3'
  title text not null,
  heading_path text[] not null,
  url text not null,                -- deep link used for citations
  file_path text not null,
  content text not null,            -- the text shown as the source
  tokens int not null,
  embedding vector(1536)            -- text-embedding-3-small output size
);

-- Same advice the docs we're indexing give: RLS on, and no default access for the API roles.
alter table doc_chunks enable row level security;
revoke all on doc_chunks from anon, authenticated;

create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id text,
  title text,
  heading_path text[],
  url text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.id, c.title, c.heading_path, c.url, c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from doc_chunks c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;




-- Keyword index. Dots become word breaks, so "db_plan_enabled" and "uid"
-- can find "pgrst.db_plan_enabled" and "auth.uid()".
alter table doc_chunks
  add column fts tsvector
  generated always as (to_tsvector('english', translate(content, '.', ' '))) stored;

create index doc_chunks_fts_idx on doc_chunks using gin (fts);

-- Hybrid search: vector ranking + keyword ranking, merged by reciprocal rank fusion
create or replace function hybrid_match_chunks(
  query_text text,
  query_embedding vector(1536),
  match_count int default 5,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  rrf_k int default 50
)
returns table (
  id text,
  title text,
  heading_path text[],
  url text,
  content text,
  score float
)
language sql stable
as $$
  with full_text as (
    select d.id,
           row_number() over (
             order by ts_rank_cd(d.fts, websearch_to_tsquery('english', translate(query_text, '.', ' '))) desc
           ) as rank_ix
    from doc_chunks d
    where d.fts @@ websearch_to_tsquery('english', translate(query_text, '.', ' '))
    order by rank_ix
    limit match_count * 4
  ),
  semantic as (
    select d.id,
           row_number() over (order by d.embedding <=> query_embedding) as rank_ix
    from doc_chunks d
    order by rank_ix
    limit match_count * 4
  )
  select c.id, c.title, c.heading_path, c.url, c.content,
         (coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
        + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight)::float as score
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join doc_chunks c on c.id = coalesce(full_text.id, semantic.id)
  order by score desc
  limit match_count;
$$;



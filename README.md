# Supabase Docs Assistant

Ask a question about **Supabase Auth or Database** and get a short answer built **only** from the official docs, with clickable citations to the exact sections it used. If the docs don't cover the question, it says so instead of guessing.

**Live demo:** https://supabase-docs-assistant.onrender.com
*(Free hosting: the first question after a quiet period can take up to a minute while the server wakes up.)*

![Screenshot of the assistant answering a question about slow RLS policies](docs/screenshot.png)

## What it does

- Answers questions about the Supabase **Auth** and **Database** guides, with `[1]`-style citations that link to the exact doc section.
- Says *"I couldn't find that in the docs"* when the retrieved sources don't contain the answer.
- Finds relevant sections by meaning (vector search), then has a model re-rank them so the best ones reach the answer.
- Shows which sources were used and which were only considered.

## How it works

```mermaid
flowchart LR
  subgraph Indexing["Indexing (run when the docs change)"]
    A["Supabase docs (MDX files)"] --> B["Clean and resolve partials"]
    B --> C["Chunk by headings"]
    C --> D["Embed with OpenAI"]
    D --> E[("Supabase Postgres: pgvector")]
  end
  subgraph Answering["Answering (every question)"]
    Q["Question"] --> R["Vector search: 30 candidates"]
    R --> S["LLM re-rank: best 8, max 3 per page"]
    S --> T["Answer from sources only, with citations"]
    T --> U["React page"]
  end
  E --> R
```

1. **Prepare the docs.** About 180 MDX pages (Auth and Database guides) from the public `supabase/supabase` repository, checked out in October 2026. MDX components, comments and link URLs are cleaned; shared **partials** and **code samples** that the live site pulls in are resolved and inlined.
2. **Chunk.** Pages are split along their headings. Every chunk keeps its heading path and a deep link to its section. Code blocks are never cut, large tables are split by rows with the header repeated, and tiny parent headings merge into their first subsection.
3. **Index.** Chunks are embedded with `text-embedding-3-small` and stored in Supabase Postgres (`pgvector`).
4. **Retrieve.** A SQL function returns the 30 chunks closest to the question by vector similarity. Identical chunks (from shared partials) are collapsed.
5. **Re-rank.** A model reads short excerpts of the 30 candidates and picks the 12 that best answer the question. No more than 3 chunks from any one page are kept, so a single page can't crowd out the others, and the best 8 remaining go to the answering model. If this step fails, the original order is used (the 3-per-page limit still applies).
6. **Answer.** A model writes the answer from those 8 sources only, cites them by number, and replies `NOT_FOUND` when they don't contain the answer.
7. **Serve.** An Express API (rate-limited, with a daily cap) and a React page that turns `[1]` markers into links.

## Engineering notes: problems I found and fixed

Most of the work was making the data right. A few examples:

- **Windows line endings** (`\r\n`) silently stopped headings from being detected, so whole pages became one chunk.
- **Nested code fences** (a ```` block containing a ``` line) flipped my "am I inside code?" tracking, which swallowed real headings. I now track the fence character and length.
- **Hidden text.** Multi-line MDX comments leaked text the live site never shows, including commented-out headings. They are now stripped before the page is split.
- **Content that isn't in the file.** Pages include shared snippets (`<$Partial>`) and sample code (`<$CodeSample>`) rendered at build time. Resolving them added 96 partials and 38 code samples to the index.
- **SDK-specific sections** (`<$Show if="sdk:dart">`) are kept with a visible `[sdk:dart]` label, so Python, Dart and C# answers don't blur together.
- **Hybrid search: built, measured, removed.** I added keyword search (merged with vector search by reciprocal rank fusion) because vector search once missed a page when queried with an exact setting name. When I compared the options on my tuning set, vector + re-rank scored better than hybrid + re-rank (MRR about 0.80 against 0.74), so I removed the keyword half to keep the system simpler.
- **Re-ranking.** For one troubleshooting question, the section that explains the fix ranked 20th by vector similarity; re-ranking moved it to first.
- **A faithfulness failure I found by checking an answer against the docs.** When only a bare bullet ("Call functions with `select`") was retrieved, the model once reversed it into "avoid calling functions with `select`". Tighter prompt rules reduced it, but the missing explanation was a retrieval problem, which is documented below as a limitation.
- **Resilient embedding.** The loader caches every vector on disk, retries failed requests with backoff, and saves with upserts, so a flaky connection never means starting over.

## Evaluation

`src/eval.ts` checks retrieval: for each question, is the page a person would be sent to among the (up to 8) sources the answering model sees? "Found" means it is anywhere in those sources, "top 3" means it is in the first three, and "first" means it is the first one.

I tuned the system on 17 questions, then ran it **once, unchanged**, on 10 new questions. Two of those were left out of the score because their expected pages are not in the index, leaving 8.

| Question set | Method | Found | Top 3 | First |
|---|---|---|---|---|
| Tuning (17) | Vector only | 17/17 | 13/17 | 9/17 |
| Tuning (17) | Vector + re-rank | 17/17 | 15/17 | 13/17 |
| **Holdout (8)** | Vector only | 7/8 | 6/8 | 5/8 |
| **Holdout (8)** | **Vector + re-rank (shipped)** | **7/8** | **6/8** | **6/8** |

- **Treat the holdout as the honest number.** The tuning set was used to make design decisions, so its scores are optimistic.
- **Re-ranking:** it clearly helped on the tuning set. On the holdout the difference is one question, so I can't claim a gain there. It fixed one question (SSR in Next.js, 5th to 1st) and hurt another (redirect URLs, 2nd to 5th).
- **The expected page is a strict test.** Each question has one expected page (occasionally two). For every holdout answer, other pages also held relevant information, so a question can count as "not found" even when the system returned something useful.
- **Answer correctness was not graded.** The scores above measure retrieval only. I did not check each answer against the docs for factual correctness.
- **Refusals:** 3 out-of-scope questions, 3 correctly answered with "couldn't find that".
- **Small samples:** with 8 questions, one question is 12.5 percentage points. Read these as indicative, not precise.
- One tuning question (about Postgres error `42501`) was removed because its answer isn't in the Auth or Database guides, so the expected page was wrong.

## Limitations

- **Scope:** only the Auth and Database guides, not the API reference or other sections.
- **Not everything is indexed.** Some pages use components that generate their content when the page renders (for example error-code tables, provider lists, extension lists). That content isn't in the source files, so those pages are incomplete in the index.
- **Link targets are dropped** from chunk text, so a bullet that only points to another section ("see X") gives the model nothing to explain. This is the cause of the misread above.
- **It can still be wrong.** Answer correctness has not been formally measured, and a small answering model can misread thin sources. Always check the linked sections.
- **Retrieval is imperfect.** Some questions return a related page instead of the exact one (a question about deleting a user's posts on account deletion did not find the cascade-deletes page), and re-ranking can push the right page down when several pages cover similar ground.
- **Vector search only.** Exact identifiers and error codes rely on the embedding to match. Hybrid search did not help on my tuning set, so I removed it.
- **A snapshot, not live.** Answers reflect the docs as of the last indexing run.
- **Free hosting:** cold starts of up to a minute, and a daily ping keeps the free database from pausing.

## Run it yourself

Requires Node 22.12 or newer (developed on Node 24), an OpenAI API key and a Supabase project.

```bash
git clone https://github.com/BoyNamedIkenna/supabase-docs-assistant.git
cd supabase-docs-assistant
npm install
cd web && npm install && cd ..
```

**1. Create the database.** Run [`sql/schema.sql`](sql/schema.sql) in the Supabase SQL editor.

**2. Add a `.env` file** in the project root (see the table below).

**3. Get the docs** (a sparse checkout of just what's needed):

```bash
git clone --filter=blob:none --depth 1 --sparse https://github.com/supabase/supabase.git source
cd source
git sparse-checkout set apps/docs/content/guides apps/docs/content/_partials examples/auth/expo-social-auth examples/auth/hono examples/auth/nextjs examples/auth/quickstarts examples/auth/sveltekit examples/auth/tanstack examples/clerk
cd ..
```

**4. Chunk and index:**

```bash
npx tsx src/inspect.ts   # chunks the docs, prints a quality report, writes chunks.json
npx tsx src/embed.ts     # embeds the chunks and loads them into Supabase
```

**5. Ask from the command line, or start the app:**

```bash
npx tsx src/ask.ts "How do I sign users in anonymously?"

npx tsx src/server.ts            # API on http://localhost:3001
cd web && npm run dev            # page on http://localhost:5173
```

**6. Run the evaluation (optional):**

```bash
npx tsx src/eval.ts                      # tuning set
npx tsx src/eval.ts eval/holdout.json    # holdout set
```

### Configuration

| Variable | Needed | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes | Embeddings, re-ranking and answers |
| `SUPABASE_URL` | yes | Your project URL |
| `SUPABASE_SECRET_KEY` | yes | Server-side key. Never expose it to the browser. |
| `CHAT_MODEL` | no | Answering model (has a default) |
| `RERANK_MODEL` | no | Re-ranking model (defaults to `CHAT_MODEL`) |
| `RERANK=off` | no | Skip the re-ranking step |
| `ALLOWED_ORIGIN` | when deployed | The page's address, for CORS |
| `MAX_PER_MINUTE`, `DAILY_LIMIT` | no | Per-visitor and total daily question limits (10 and 300) |
| `VITE_API_URL` (in `web/`) | when deployed | The API's address |

## Project structure

```
src/
  sections.ts, clean.ts, includes.ts, chunker.ts   docs -> chunks
  inspect.ts                                       chunking quality report
  embed-lib.ts, embed.ts                           embedding (cache, retries) and loading
  search-lib.ts, search.ts                         duplicate removal, command-line search
  rerank-lib.ts, ask-lib.ts, answer.ts, clients.ts re-ranking, prompts, the answering pipeline
  app.ts, server.ts, rate-limit.ts                 the API
  ask.ts                                           command-line question
  eval-lib.ts, eval.ts                             retrieval evaluation
eval/                                              tuning, holdout and out-of-scope questions
web/                                               React + Vite + Tailwind page
sql/schema.sql                                     table, vector search function, security settings
render.yaml, .github/workflows/keepalive.yml       deployment and daily keep-alive
```

## Deployment

The page (a static site) and the API (a web service) both run on Render and are created from `render.yaml`. A daily GitHub Actions ping keeps the free Supabase project from pausing. The database table has Row Level Security on with no policies, so only the server's secret key can read it.

## Roadmap

- Grade answer correctness, not just retrieval, on a larger holdout set.
- Allow more than one acceptable page per question in the evaluation.
- Keep link targets in chunk metadata so "see X" pointers can be followed.
- Stream answers as they are written.
- Let visitors pick their SDK and show only that language's code.
- Add automated tests and CI.

## License

Released under the [MIT License](LICENSE). Supabase documentation content remains
the property of Supabase and is not covered by this license.

## Acknowledgements

All documentation content belongs to [Supabase](https://supabase.com/docs) and is indexed from the public [supabase/supabase](https://github.com/supabase/supabase) repository. This project is not affiliated with or endorsed by Supabase, and the docs themselves are not redistributed in this repository.
# JobTailor

JobTailor is a web workspace that analyzes an uploaded PDF or DOCX resume against a target job description, then returns evidence-based matching results and prioritized revision suggestions. The active app is a single Next.js full-stack project.

## Try it online

Use JobTailor at [https://job.nianan.ggff.net/](https://job.nianan.ggff.net/).

## Project structure

```text
app/         Next.js pages and server-side API routes
components/  User interface components
lib/         Resume matching and AI integration
tests/       End-to-end tests
```

## Run locally

Start the app:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## AI configuration

The complete workflow runs in local preview mode without a model key. To enable AI analysis, copy `.env.local.example` to `.env.local` and configure a Chat Completions-compatible provider:

```text
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-key
AI_MODEL=your-model
```

Resume files are parsed in memory and are not stored. When AI mode is configured, starting an analysis sends extracted resume text and the job description to the configured model provider. AI editing sends the current draft and the editing instruction. Local analysis and file export do not call the model. The page explains this before either AI action; remove personal information you do not want to send before proceeding.

Drafts keep their original resume filename and target job description when the inputs change. Regenerating an existing draft opens a comparison before replacing it, and the previous version can be restored with Undo. Supplementary reminders cannot be directly applied as resume text.

PDF export checks whether the bundled font can display every non-whitespace character. If a name or another character is unsupported, the app asks the user to download DOCX instead of silently producing a PDF with missing text.

Drafts stay in the current page by default. Users can opt in to saving the draft text, source resume text, target job description, and previous version in this browser, then use “恢复本机草稿” after a reload. AI edits stay in a separate preview until the user confirms them. New numbers and technical terms, and added/rewritten/deleted lines, are marked as review cues rather than factual verification. Incomplete or empty previews cannot replace a draft. During AI editing, the saved copy keeps the original complete draft. “清除本机草稿” removes the browser copy without clearing the editor.

Local matching recognizes a limited technical skill vocabulary, simple alternative groups, and required versus preferred skills. Missing preferred skills do not lower the score. When no supported required skills are recognized, no numeric match score is shown. This heuristic does not establish actual skill proficiency or overall suitability.

## Anonymous service limits

AI analysis and editing share a limit of 6 requests per browser per 10 minutes, with at most 2 concurrent requests. The server process allows 60 AI requests per hour and 4 concurrent AI requests globally. Local parsing, analysis, generation, and export use separate quotas (60 requests per browser per 10 minutes, 3000 globally per hour, and 6 global concurrent requests).

The server issues a signed HttpOnly browser cookie and does not trust client-supplied forwarding headers. Clearing cookies does not bypass global limits. Responses exceeding a quota return HTTP 429 with a retry time; oversized request bodies return HTTP 413. Text lengths, suggestion counts, output length and generation budgets are also bounded. Canceling or disconnecting stops model requests and releases concurrent request slots.

Limits are held in process memory, reset on restart, and protect the current single-instance deployment. Multiple replicas need a shared limiter. These request limits are not a billing cap; keep an appropriate spending limit with the model provider as well.

## Checks

```powershell
npm run lint
node --test tests/*.test.mjs
npm run build
npm run test:e2e -- workspace.spec.ts
```

## Deploy with Docker Compose

The production container listens on host port `3200` and exposes a health check
at `/api/health`.

```bash
cp .env.production.example .env.production
# Add the optional AI provider settings to .env.production.
bash scripts/deploy.sh
```

To rebuild and restart automatically after a successful `git pull` or merge,
install the repository-local post-merge hook once:

```bash
bash scripts/install-post-merge-hook.sh
```

The hook is local to the server clone and is never committed. A failed image
build leaves the currently running container untouched.

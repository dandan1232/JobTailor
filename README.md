# JobTailor

JobTailor is a web workspace that analyzes an uploaded PDF or DOCX resume against a target job description, then returns evidence-based matching results and prioritized revision suggestions. The active app is a single Next.js full-stack project.

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

Resume files are parsed in memory and are not stored. When AI mode is configured, extracted resume text and the pasted job description are sent to the configured model provider only after the user starts an analysis.

## Checks

```powershell
npm run lint
npm run build
npm run test:e2e
```

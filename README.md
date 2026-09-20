# JobTailor

JobTailor is a web workspace that analyzes an uploaded PDF or DOCX resume against a target job description, then returns evidence-based matching results and prioritized revision suggestions.

## Project structure

```text
frontend/  Next.js and TypeScript user interface
backend/   FastAPI matching API
docs/      Local research material (ignored by Git)
```

## Run locally

Start the API:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

Start the web app in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## AI configuration

The complete workflow runs in local preview mode without a model key. To enable AI analysis, copy `.env.example` to `.env` and configure a Chat Completions-compatible provider:

```text
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-key
AI_MODEL=your-model
```

Resume files are parsed in memory and are not stored by the backend. When AI mode is configured, extracted resume text and the pasted job description are sent to the configured model provider only after the user starts an analysis.

## Checks

```powershell
cd frontend
npm run lint
npm run build
npm run test:e2e

cd ..
.\.venv\Scripts\python.exe -m pytest backend\tests
```

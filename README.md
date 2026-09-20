# JobTailor

JobTailor is a web workspace that turns a developer's real project experience into a job-specific resume strategy. The first version uses transparent local matching rules so the complete workflow can run without an AI key.

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

## Checks

```powershell
cd frontend
npm run lint
npm run build
npm run test:e2e

cd ..
.\.venv\Scripts\python.exe -m pytest backend\tests
```

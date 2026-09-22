# Octaraa Online Will

React + TypeScript + Vite front end with a small Node API gateway (`server/`).

```bash
npm install
cp .env.example .env.local   # then edit; see INTEGRATIONS.md
set -a; source .env.local; set +a
npm run api    # API on :8787
npm run dev    # app on :5173
npm test       # client + server tests
npm run build && npm run lint
```

* `INTEGRATIONS.md` — API, auth model, providers, production notes.
* `TASK_IMPLEMENTATION_STATUS.md` — what is built, verified, and still needs external setup.
* `database/schema.sql` — PostgreSQL contract.

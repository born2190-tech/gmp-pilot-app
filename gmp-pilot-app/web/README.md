# GMP Pilot Frontend

Frontend stack:

- React + TypeScript + Vite
- Tailwind CSS v4
- Component-based dashboard aligned to GMP flow

## Run

```bash
npm install
npm run dev
```

Default dev URL: `http://127.0.0.1:5173`

## Backend URL

Create `.env` from `.env.example` and set:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Available MVP UI

- Login via `/auth/login`
- Session check via `/auth/me`
- Lots board via `GET /lots`
- Movements board via `GET /inventory/movements`

Current focus is operational workflow UI with strict backend-enforced RBAC and warehouse scope.

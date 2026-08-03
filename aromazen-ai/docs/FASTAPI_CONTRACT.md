# FastAPI integration contract

The browser calls `/api/v1/*` on the Next.js origin. `next.config.mjs` forwards that path to `BACKEND_API_ORIGIN`, so the FastAPI service is never exposed directly to the browser.

## Authentication

- `POST /api/v1/auth/login` receives `{ email, password, remember_me }`, sets secure HTTP-only session cookies, and returns `{ user }`.
- `POST /api/v1/auth/logout` clears the session cookies and returns `204`.
- `GET /api/v1/auth/me` returns the current user or `401`.

## Initial application endpoints

- `GET /api/v1/dashboard/overview`
- `GET /api/v1/knowledge/collections`
- `GET /api/v1/knowledge/documents`
- `POST /api/v1/workspace/messages`

Response shapes are defined in `lib/api/types.ts`. FastAPI should return those objects directly and use `{ "detail": "..." }` for error responses.

## Cookie and proxy rules

- In development, set `BACKEND_API_ORIGIN=http://localhost:8000`.
- Keep API requests same-origin at `/api/v1`; `credentials: include` is already configured in `lib/api/client.ts`.
- In production, Nginx must pass the original `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` headers to Next.js and FastAPI.
- FastAPI should issue refresh cookies as `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to `/api/v1/auth`.

# AROMAZEN AI API

## Local startup

1. Copy `.env.example` to `.env` at the repository root and set `POSTGRES_PASSWORD`.
2. Start the full stack with `docker compose up --build`.
3. Open `http://localhost:8000/api/v1/health`.

For running FastAPI outside Docker, copy `backend/.env.example` to `backend/.env` first.

The first functional module will be `identity`, providing invitations, authentication, roles, permissions, sessions, and audit events.

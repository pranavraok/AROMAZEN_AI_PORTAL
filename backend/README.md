# AROMAZEN AI API

## Local startup

1. Copy `.env.example` to `.env` at the repository root and set `POSTGRES_PASSWORD`.
2. On Windows, start the complete portal from the repository root with
   `powershell -ExecutionPolicy Bypass -File .\scripts\start_portal.ps1`.
   This starts both Docker services and the local Microsoft Word helper required
   for Appointment, Spot Appreciation, and Special Increment PDF previews.
3. Open `http://localhost:3001`. The API health endpoint is
   `http://localhost:8000/api/v1/health`.

Running `docker compose up --build` by itself does not start the Windows Word
helper. Use the launcher above whenever HR Word-template previews are required.

For running FastAPI outside Docker, copy `backend/.env.example` to `backend/.env` first.

The first functional module will be `identity`, providing invitations, authentication, roles, permissions, sessions, and audit events.

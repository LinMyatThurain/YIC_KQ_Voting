# Render and Supabase Deployment Plan

**Goal:** Deploy the YIC voting app at a stable Render URL with Supabase PostgreSQL storage.

**Architecture:** Local development and tests continue using SQLite. When `DATABASE_URL` is present, the server uses a PostgreSQL store backed by Supabase. The browser keeps same-origin API URLs, so the Render URL works without frontend configuration.

**Deployment:** Render builds with `npm install` and starts with `npm start`. Supabase provides `DATABASE_URL`; credentials remain in Render environment variables.

## Tasks

- Add a PostgreSQL store with the existing candidate and vote behavior.
- Select PostgreSQL only when `DATABASE_URL` is configured.
- Keep SQLite available for local tests.
- Add Render service configuration and deployment documentation.
- Run the complete existing test suite and JavaScript checks.
- Create a Supabase project and Render service manually without exposing secrets.

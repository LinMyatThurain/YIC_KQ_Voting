# YIC Voting Account Handoff

Use this guide to deploy the current voting project under a different GitHub, Supabase, and Render account.

## What this project contains

- `index.html`: voter registration and admin entry using `admin@yic`
- `voting_page.html`: voting form
- `admin.html`: results dashboard
- `candidate_admin.html`: candidate management
- `server.js`: Node web server and API
- `postgres-store.js`: Supabase PostgreSQL storage adapter
- `render.yaml`: Render deployment settings
- `DEPLOYMENT.md`: full deployment reference

## 1. Create a new GitHub repository

Create a private empty repository under the new GitHub account. From this project folder, run:

```powershell
git init
git add .
git commit -m "Initial YIC voting app"
git branch -M main
git remote add origin https://github.com/NEW-ACCOUNT/NEW-REPOSITORY.git
git push -u origin main
```

Replace the account and repository placeholders. Do not commit `.env` files, database files, passwords, or connection strings.

## 2. Create a new Supabase project

1. Sign in to the new Supabase account.
2. Create a new project.
3. Open **Connect**.
4. Copy the Node.js PostgreSQL connection string.
5. Prefer the Session pooler connection when Supabase provides both direct and pooler options.

The application automatically creates these tables on its first connection:

- `candidates`
- `votes`
- `settings` (including the persisted voting open/closed state)

It also seeds the default candidate catalog if the catalog is empty.

## 3. Create the Render service

1. Sign in to the new Render account.
2. Choose **New > Blueprint** or **New > Web Service**.
3. Connect the new GitHub repository.
4. Use the included `render.yaml`, or set:

```text
Build command: npm install
Start command: npm start
Health check path: /
```

Add these Render environment variables:

```text
DATABASE_URL=<Supabase PostgreSQL connection string>
ADMIN_EMAIL=admin@yic
ADMIN_PASSWORD=<private admin password>
NODE_VERSION=22
```

Never place `DATABASE_URL` or `ADMIN_PASSWORD` in the repository.

## 4. Test the new deployment

Open the Render URL from a phone using mobile data and verify:

1. The registration page loads.
2. Candidates load on the voting page.
3. A complete vote is accepted.
4. A second vote from the same email is rejected.
5. Entering `admin@yic` opens the admin results page.
6. Candidate management can add, edit, and permanently delete candidates.
7. The admin panel can start and stop voting.
8. The voting page shows a 10-second countdown when voting starts and blocks submissions while voting is stopped.
9. Results show the submitted vote.

## 5. Updating the project later

Edit the project locally, run the tests, then push changes:

```powershell
cmd /c npm test
git add .
git commit -m "Describe the change"
git push
```

Render automatically redeploys the same stable URL after the push.

## Existing local data

The local `votes.db` file is separate from the new Supabase database. A new Supabase project starts with the candidate catalog but does not automatically contain local votes or local candidate edits.

Keep `votes.db` as a backup. Do not upload it to GitHub. If existing votes must be transferred, export and import them deliberately after reviewing the data.

## Important secrets

Never share or commit:

- Supabase `DATABASE_URL`
- Render `ADMIN_PASSWORD`
- `.env` files
- Supabase project service-role keys
- GitHub access tokens

Only store these values in the relevant provider's protected environment-variable settings.

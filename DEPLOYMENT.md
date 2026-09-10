# Render + Supabase Deployment

This deployment gives the voting app a stable Render URL and stores votes and candidates in Supabase PostgreSQL.

## 1. Create the Supabase database

1. Create a Supabase project.
2. Open **Connect** and choose the Node.js connection details.
3. Prefer the **Session pooler** connection string when Supabase offers both direct and pooler options.
4. Copy the full PostgreSQL connection string. Do not commit it or send it in chat.

The app creates its `votes` and `candidates` tables and seeds the candidate catalog on its first connection.

## 2. Put the project in GitHub

From the project folder:

```powershell
git init
git add .
git commit -m "Prepare hosted voting deployment"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Create the GitHub repository first and keep it private if the source should not be public.

## 3. Create the Render service

1. Create a Render account and choose **New > Blueprint** or **New > Web Service**.
2. Connect the GitHub repository.
3. Render can use `render.yaml`, or use these values manually:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/`
4. Add these environment variables in Render:
   - `DATABASE_URL`: the Supabase PostgreSQL connection string
   - `ADMIN_EMAIL`: `admin@yic`
   - `ADMIN_PASSWORD`: a private admin password
5. Deploy the service.

Render gives the app a stable address similar to:

```text
https://yic-voting.onrender.com
```

Use that URL for the QR code.

## 4. Verify before the event

Open the Render URL from a phone using mobile data and verify:

- registration loads;
- a complete vote can be submitted;
- duplicate email submissions are rejected;
- admin access works with `admin@yic`;
- candidate changes appear in the catalog;
- results show the submitted vote.

## 5. Updates

After changing the project locally:

```powershell
git add .
git commit -m "Describe the change"
git push
```

Render automatically redeploys the same URL. Wait for the deployment to finish before testing the change.

## Important hosting notes

- The Supabase database is persistent; the Render service's local filesystem is not the source of truth.
- Candidate image uploads are stored as data URLs in PostgreSQL. Seeded image paths must remain in the repository.
- Free Render services may sleep after inactivity, so the first event request can be slow. The URL remains the same.
- Keep the Supabase connection string and admin password only in Render environment variables.

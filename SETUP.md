# Setting up the live demo

The code, database schema, and docs are done and committed locally. Everything below is stuff only you can do, since it all means clicking around in dashboards I don't have access to. Follow these in order.

## 1. Create the new Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Name it something like `esstisch-demo`.
3. Region: **Europe (Frankfurt)** (`eu-central-1`), per what we agreed.
4. Pick a database password and save it somewhere (a password manager, not a chat). You won't need it day-to-day since the app connects with the anon key, but Supabase asks for one.
5. Wait for the project to finish provisioning (a minute or two).

## 2. Run the setup SQL

1. In the new project, open the **SQL Editor** (left sidebar).
2. Open [sql/setup.sql](sql/setup.sql) from this repo, copy the whole file, and paste it into a new query.
3. Run it. This creates all 10 tables, sets up the split RLS policies, seeds the real meal/ingredient data, seeds the 4 demo people, and populates a baseline week. It also tries to schedule the `pg_cron` job at the very end, and that part will fail with an error about `cron.schedule` not existing, which is expected (see step 3). Everything before that will have already succeeded.

## 3. Enable pg_cron and finish scheduling

This can't be done from SQL, only from the dashboard:

1. Go to **Database -> Extensions** in the left sidebar.
2. Search for `pg_cron` and toggle it on.
3. Back in the **SQL Editor**, run just this block again. It's the last block in `sql/setup.sql`, already run once and failed; that's fine, re-running is safe:
   ```sql
   select cron.schedule(
     'esstisch-demo-daily-reset',
     '0 4 * * *',
     $$select reset_demo_data();$$
   );
   ```
4. To confirm it's scheduled: **Database -> Cron Jobs** should show `esstisch-demo-daily-reset` running daily at 04:00 UTC.

## 4. Get your API credentials

1. Go to **Project Settings -> API**.
2. Copy the **Project URL** and the **anon / public key** (not the service_role key, which should never leave the dashboard).

## 5. Set up the local `.env`

In `C:\Users\charl\Scribli-Apps\esstisch-demo`:

```powershell
cp .env.example .env
```

Edit `.env` and fill in:
```
VITE_SUPABASE_URL=<your project URL>
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_APP_USERS=person1:demo1234,person2:demo1234,person3:demo1234,person4:demo1234
```

Test it locally:
```powershell
npm run dev
```
Open `http://localhost:5173`, log in as `person1` / `demo1234`, and confirm the meal library, planner, and shopping list all load with real data.

## 6. Create the GitHub repository

1. Go to [github.com/new](https://github.com/new).
2. Name it `esstisch-demo`, set it **Public**, don't initialize with a README (this repo already has one).
3. Push the existing local repo:
   ```powershell
   cd C:\Users\charl\Scribli-Apps\esstisch-demo
   git remote add origin https://github.com/<your-username>/esstisch-demo.git
   git push -u origin main
   ```

## 7. Create the Netlify site

1. Go to [app.netlify.com](https://app.netlify.com) -> **Add new site -> Import an existing project**.
2. Connect your GitHub account if you haven't, and pick the `esstisch-demo` repo.
3. Build settings should auto-detect from `package.json`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Before deploying, add environment variables: **Site configuration -> Environment variables**, add the same three keys from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_USERS`
5. Deploy. Netlify gives you a `*.netlify.app` URL. You can rename it under **Site configuration -> Site details -> Change site name** to something like `esstisch-demo`.

## 8. Final checks

- Open the live URL, confirm it loads and you can log in as each of the 4 demo people.
- Log in as `person1` (parent), lock the current week, then switch to `person3` (kid) and confirm the plan is locked for them.
- Try the "Add a meal" button while logged in. It should show the friendly "read-only in this public demo" message rather than a raw error.
- Drop the live URL into [README.md](README.md) where it currently says "add the Netlify URL here once deployed", commit, and push.
- Take the screenshots listed in the README once everything above looks right, and add them to the README.

That's it. From here, updating the demo follows the same loop as the real app (`updating_esstisch.md` in the real project's docs), just pointed at this repo and this Supabase project instead.

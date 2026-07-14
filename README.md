# Esstisch Demo

A family meal-planning app: a meal library with real recipes, a weekly planner, an auto-generated shopping list, cooking history, ratings, and a stats dashboard.

**This is a sanitized public version of a real app I built for my own family.** Esstisch has been in daily use by two adults and two kids for months. The recipes, ingredient data, and Swiss grocery costs in this demo are the real ones from that app. What's different here is everyone's identity: real names are replaced with four generic demo logins, and the database access rules are tightened for a public URL instead of a private family one (see [GOVERNANCE.md](GOVERNANCE.md) for exactly what changed and why).

**Live demo:** https://esstisch-demo.netlify.app/

## Try it

Log in with any of these. All four share the password `demo1234`:

| Username | Role |
|---|---|
| `person1` | parent |
| `person2` | parent |
| `person3` | kid |
| `person4` | kid |

These aren't meant to be secret. They're published here on purpose, so you can log in as a "parent" and a "kid" and see the difference: kids can't lock or unlock a week, can't clear a planned day or use the shuffle feature once a week is locked, and can't touch the shopping list lock at all.

A few things worth trying:
- **Library tab:** filter by cuisine, search, mark a favourite.
- **Plan tab:** tap an empty day to assign a meal, or use "shuffle empty days" to auto-fill based on what hasn't been cooked recently.
- **Shop tab:** the shopping list aggregates ingredients across the whole week's meals automatically, grouped by category, with a plain-text export.
- **Report tab:** cost trends, most-cooked meals, top cuisines, and favourites by person, once there's cooking history to show.
- Log in as `person1` (parent) and lock a week, then switch to `person3` (kid) and see what's restricted.

The demo resets to a clean, populated baseline once a day, so nothing you do here is permanent, and you'll never land on an empty app.

## Tech stack

- **React + Vite + Tailwind CSS v4** for the frontend
- **Supabase** (Postgres + Realtime) for the backend, with Row Level Security split by table role for this public deployment
- **GitHub -> Netlify** for deployment
- Installable as a **PWA**, with the shopping list working fully offline

## What this demonstrates

- A real, non-trivial data model (meals, ingredients, weekly plans, favourites, ratings, locks) built from an actual working spreadsheet, not invented for a portfolio
- Realtime multi-device sync (open the demo on two tabs and watch changes appear on both)
- A simple but real role-based access control example (parent/kid)
- A deliberate, documented security decision for going from a private tool to a public one, including a scheduled reset job (`pg_cron`) rather than just hoping nobody misuses it
- Two honestly-told incidents from building the real app (a data-integrity bug and a leaked credential), both in [GOVERNANCE.md](GOVERNANCE.md)

## Running it locally

```
npm install
cp .env.example .env   # fill in your own Supabase project's URL and anon key
npm run dev
```

The database schema, seed data, and RLS policies are in [sql/setup.sql](sql/setup.sql). Run that once in a fresh Supabase project's SQL Editor before starting the app.

## More detail

[GOVERNANCE.md](GOVERNANCE.md) covers access control design, the RBAC model, two real incidents from building the original app, data minimization, and this project's honest limitations.

Deploying your own copy of this demo (new Supabase project, GitHub repo, Netlify site)? See [SETUP.md](SETUP.md) for exact steps.

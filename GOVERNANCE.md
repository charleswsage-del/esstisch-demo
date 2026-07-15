# Governance and data handling

This document explains how Esstisch (and this public demo of it) handles access control, roles, data, and the mistakes I made and fixed along the way. It's meant to be read plainly, not as a compliance checkbox.

## Access control: the real app vs. this demo

The real Esstisch runs on a private Supabase project shared by my family. Its Row Level Security (RLS) policies grant full read and write access to anyone holding the project's public "anon" key: `for all using (true) with check (true)` on every table. That sounds permissive, and it is, but it's a reasonable choice for that context. The anon key is embedded in client-side JavaScript no matter how strict the policies behind it are, so it's never actually secret. The real protection is that the app's URL isn't published anywhere; only my family knows it exists. Given a small, trusted user base and a private URL, tightening RLS further wouldn't have bought much and would have added real complexity (per-user auth, row ownership, session management) for a family meal planner.

This demo is different because the URL is shared publicly and the visitors are anonymous strangers, not four people I know. The same "grant everything to anon" policy that's fine for a private family tool would let any visitor delete meals, spam the planner, or leave something inappropriate in the shopping list for the next person (a recruiter, say) to see. So this project splits its RLS by table role instead of using one blanket policy:

- **Reference tables** (`meals`, `ingredients`, `people`, `settings`) are read-only for the anon role. Nobody can add, edit, or delete a meal from the public demo.
- **Interactive tables** (`weekly_plan_days`, `shopping_checked`, `favourites`, `meal_ratings`, `week_locks`, `shopping_locks`) stay fully read-write for anon, because trying the planner, the shopping list, favourites, and the lock feature is the whole point of a demo.

That split alone isn't enough on its own, since a determined visitor could still fill the interactive tables with junk over time. So this project also runs a `pg_cron` job (`reset_demo_data()` in [sql/setup.sql](sql/setup.sql)) once a day that clears the interactive tables and reseeds a realistic baseline week. The exact schedule and the baseline data are documented in that file. The result: the meal library can't be vandalised at all, and anything else a visitor changes gets wiped and reset to a clean, populated state within 24 hours.

## Role-based access control

Every person in the `people` table has a `role` of either `parent` or `kid`. It's a single text column, not a permissions framework, but it's a real least-privilege example:

- A `kid` cannot lock or unlock a week or the shopping list.
- A `kid` cannot clear a planned day, use the "shuffle empty days" feature, or change the plan at all once a parent has locked the week.
- A `kid` *can* still mark a meal as cooked even on a locked week, check off shopping items (unless the shopping list is separately locked), leave ratings, and toggle favourites.

The checks live in the UI (`isKid` gates in `App.jsx`) rather than in RLS, which is an honest limitation worth naming: a technically sophisticated visitor could call Supabase directly and bypass the kid restriction. For a family app where the "attacker" is a ten-year-old with an iPad, that's a proportionate level of enforcement. It would not be proportionate for anything handling money or sensitive data.

## Incident 1: the favourites bug

The real app's `favourites` table originally had a check constraint listing valid people by capitalised first name. Later, when I added a proper `people` table (for colours, initials, and eventually roles), I gave each person a lowercase id. The check constraint never got updated to match. Every favourite anyone tried to save after that point was silently rejected by Postgres. Nothing crashed and no error surfaced in the UI. I found it by accident, checking the browser console after a favourite tap didn't seem to do anything, and saw a Postgres constraint violation staring back at me.

The fix in the real app was a migration to correct the constraint's casing. For this demo, I went further: `favourites.person` is now a foreign key into `people(id)` instead of a hardcoded list at all (see the schema in [sql/setup.sql](sql/setup.sql)). A foreign key can't drift out of sync with the table it's supposed to reference the way a hardcoded check constraint can. That's the actual lesson from this bug: the fix isn't just correcting the values, it's removing the class of bug entirely.

## Incident 2: a leaked credential in git history

Early on, I put a Netlify Basic-Auth gate in front of the real app (`public/_headers`), with a username and password per family member, committed directly into the repository in plain text. It worked, but it meant real credentials sat in git history indefinitely, readable by anyone with repo access, and rotating them meant editing a committed file. I later replaced that gate with the in-app login system Esstisch uses now (`VITE_APP_USERS`, read from an environment variable, never committed), which meant the same protection without secrets living in source control. The old credentials were rotated once the new approach was live.

This demo doesn't carry that file over at all. Its login list is generated fresh, lives only in environment variables (`.env` locally, Netlify's dashboard in production), and is documented in [.env.example](.env.example) as placeholders, never real values.

## Data minimisation

This app, in both its real and demo forms, collects:

- A first name or demo identity (`people.name`)
- Meal preferences: favourites, ratings, what's been cooked and when
- Cost data tied to meals and ingredients, not to any individual

It does not collect or run:

- Analytics or tracking scripts of any kind
- Location data
- Anything beyond what the app itself functionally needs to work

## Data residency

This demo's Supabase project is hosted in the EU (Central) region.

## Honest limitations

This is a portfolio demo of a real family tool, not production software, and it's worth being direct about what it doesn't have:

- **No real authentication provider.** Login is a plaintext password list matched client-side. It's adequate for "let a visitor try the parent/kid difference," not for anything that needs real security.
- **No audit log.** There's no record of who changed what, beyond the `chosen_by` and `locked_by` fields the app already tracks for its own features.
- **No data export or deletion tooling** for a demo visitor's own data (a genuine "download my favourites as JSON" or "delete everything I've added" feature). This was scoped out of the first version deliberately, not overlooked; it's a natural next addition if this app needed to handle real user data at any scale.
- **No formal privacy notice.** This document is the closest thing to one, and it's written for a technical audience, not as a legal instrument.

If this app ever needed to scale past a demo or a single family, all four of those would need to be built properly before it should hold anyone else's data.

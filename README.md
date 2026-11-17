# Sankalp — Hanuman Chalisa, Sadhana & Naam Jaap

A PWA for tracking Hanuman Chalisa (and any other sadhana) across family phones, with reminders, plus a private Naam Jaap counter with analytics, goals and reminders.

## What's already set up
- **Database**: Supabase project `ramani-meds`, tables `sk_families`, `sk_members`, `sk_sadhanas`, `sk_logs`, `sk_push_subs`, `sk_secrets` (the medicine app's tables are untouched).
- **Security**: every row carries a family code; the database only returns rows whose code matches the `x-family-code` header the app sends. No code → no data.
- **Notifications**: edge function `sankalp` + cron job `sankalp-tick` (every 5 min) sends the daily reminder, the evening nudge if the day isn't done, and a note to the family when someone finishes their day.

## Put it online (GitHub Pages)
1. Create a new repo on GitHub, e.g. `BalenduS/sankalp`.
2. Upload these files to it (keep the folders): `index.html`, `sw.js`, `manifest.webmanifest`, `icons/`.
3. Repo → Settings → Pages → Deploy from branch → `main` / root.
4. Open `https://balendus.github.io/sankalp/` on your phone.

## Install on the phones
- **iPhone**: open the link in Safari → Share → *Add to Home Screen* → open it from the home screen → Today tab → *Enable* reminders. (Needs iOS 16.4+; notifications only work from the home-screen app.)
- **Android**: open in Chrome → *Install app* → Enable reminders.
- **Your brother**: Settings → *Share invite link* → he opens it, taps Continue, enters his name.

## Adding a new kind of sadhana
Any sadhana can be added from the app via **+ → Other**. To add a preset with its own plans, add an entry to `KINDS` in `index.html`.

## Custom domain
`CNAME` points GitHub Pages at **sankalp.balendu.me**. At your DNS provider add:
`CNAME  sankalp  →  balendus.github.io`

## Naam Jaap (the Jaap tab)
Private to each signed-in person (not shared with the family).
- **Counter**: a 108-bead mala; tap anywhere on it. Works offline; every tap is saved on the phone at once and synced as an absolute count, so retries never double-count. A session that runs past midnight is split across the two days.
- **My Journey**: totals for Today / 7 / 30 / 90 days / this year / all time / custom; daily bar chart (repetitions, malas, time; tap a bar); calendar heatmap (tap a day); per-mantra statistics; consistency; trends (shown only when there is enough data); milestones and personal records.
- **Goals**: daily repetitions, daily malas, weekly malas, monthly repetitions, per mantra or overall. Changing a goal closes the old one yesterday and starts the new one today, so past days keep the goal they had.
- **Reminders**: scheduled, incomplete-goal, resume-session, daily summary, weekly reflection; days of week, mantra, target, sound, snooze. **Pause all** for a day, 3 days, a week or until resumed.
- **History**: every session, filter by mantra and date, correct or delete (statistics recalculate).

### Backend (Supabase project `ramani-meds`)
- Tables: `jaap_mantras`, `jaap_sessions`, `jaap_events` (source of truth: one row per session per local day), `jaap_daily_progress` (kept by triggers), `jaap_goals`, `jaap_reminders`, `jaap_delivery_logs`, `jaap_milestones`, `jaap_settings`. Row-level security: each person sees only their own rows. Schema: `supabase/migrations/20261117_naam_jaap.sql`.
- Edge function `jaap` (`supabase/functions/jaap`): sends due reminders via web push using the same VAPID keys and push subscriptions as Sankalp. Each delivery is claimed with a unique key first (no duplicates), failed sends retry up to 3 times within an hour, times are evaluated in the reminder's own time zone (daylight saving safe), paused accounts are skipped.
- Cron job `jaap-tick` runs the function every minute.
- On iPhone, notifications need iOS 16.4+ and the app added to the Home Screen; notification action buttons (Snooze) appear on Android only.

### Tests
`node --test tests/jaap-core.test.js` (calculations: counts, malas, midnight, ranges, streaks, goals and goal history, edits, milestones, trends).

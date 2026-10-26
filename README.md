# Sankalp — Hanuman Chalisa & Sadhana tracker

A PWA for tracking Hanuman Chalisa (and any other sadhana) across family phones, with reminders.

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

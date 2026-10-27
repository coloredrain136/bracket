# Bracket

Free, phone-first, **unofficial** finder for Michigan pickleball tournaments. Data comes from pickleballtournaments.com; registering always happens on their site.

## Files
- `index.html`: the whole app (HTML/CSS/JS, no build step). Glass design system with tokens at the top of the `<style>`; an inline head script (`BracketLooks`) sets light/dark, theme-color and the iPhone status bar style before first paint.
- `manifest.webmanifest`, `apple-touch-icon.png`, `icons/`: home-screen app and the paddle icon
- `api/tournaments.js`: upcoming Michigan tournaments (cached 30 min at Vercel's edge; add `?debug=1` to see how the fetch went). Each item's `ev.list` has every event in short form `[id, title, format, lo, hi, registered, max, waitlist]` for per-event filtering and the optional "Best event on cards" line.
- `api/cron.js`: hourly notification check (called by Supabase pg_cron). Alert types: partner, tomorrow, closing, early, changes.
- `api/tournament.js`: one tournament's details + events (`?slug=midwest-open`)
- `api/_lib/pt.js`: pickleballtournaments.com helpers (finds the site's search action by name, parses tournament pages). Copied from Rally's rally-4 engine, not shared with it.
- `api/share.js`: `/t/<slug>` share links. Serves index.html with the tournament's name, dates and city in the link-preview tags (vercel.json rewrites `/t/:slug` here and bundles index.html with it).
- `api/ics.js`: calendar file for one tournament (`?slug=`), all-day event(s).
- `api/config.js`: app version (old home-screen copies reload once), the Supabase URL + publishable key for sign-in, and whether feedback is on.
- `api/feedback.js`: Settings → Send feedback. Saves to the `bracket_feedback` table (read it in Supabase → Table Editor).
- `api/account.js`: deletes a signed-in person's account (their saves go with it).
- `api/_lib/sb.js`: small Supabase helpers for the server (plain fetch, no packages).
- `api/_lib/find.js`: shared helpers for those routes, and `APP_VERSION`. **Bump it together with `VERSION` in index.html every build.**
- `og.png`: the link-preview picture (1200×630).
- `vercel.json`: time limits, the `/t/:slug` rewrite, and `noindex` on every page so Bracket stays out of search results.

## On each phone (localStorage)
- `bracket_settings`: home location, ratings (general + doubles/singles), saved partners (`partners`: name, rating, mixed or doubles), notification types, List or Calendar, filters (incl. weekend / dates, level fit / up), looks, text size, Mine tab
- `bracket_saves`: `{ interested: {slug: snapshot}, registered: {slug: snapshot} }`. A snapshot may carry `alerts` (per-tournament alert choices). (`picks` from bracket-11 is no longer used.)
- `bracket_list`: last tournament list (opens instantly, shown if the data source is down)
- `bracket_details`: last 30 tournament details

## Links
- `/t/<slug>` (or `/?t=<slug>`) opens Bracket straight to a tournament.

## Analytics
Vercel Web Analytics script is in index.html; turn it on in Vercel → the project → Analytics.

## Accounts (Supabase project "bracket")
Google sign-in through Supabase Auth. Lives in Joe's **Builds** Supabase project (free-plan project limit). Tables `bracket_saves`, `bracket_profile`, `bracket_feedback`, `bracket_partner_posts`, `bracket_partner_requests`, all with Row Level Security (SQL in the build zips: 1-schema, 2-partners, 3-ratings, 4-notifications, 5-notify-job, 6-my-partners; from bracket-11 they're in each zip's `supabase/` folder). Signed out, everything stays in the browser; first sign-in on a device merges that device's saves into the account.

## Vercel env vars
- `SUPABASE_URL`: the Bracket Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY`: publishable key (sent to the browser; safe because of Row Level Security)
- `SUPABASE_SECRET_KEY`: secret key (server only: feedback + delete account). Never put this in the app or GitHub.
- `PT_ACTION_ID` (optional, normally unset): pins pickleballtournaments.com's search action id by hand if finding it automatically ever breaks.

Env var changes need a Redeploy.

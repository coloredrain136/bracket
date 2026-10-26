# Bracket

Free, phone-first, **unofficial** finder for Michigan pickleball tournaments. Data comes from pickleballtournaments.com; registering always happens on their site.

## Files
- `index.html`: the whole app (HTML/CSS/JS, no build step). Glass design system with tokens at the top of the `<style>`; an inline head script (`BracketLooks`) sets light/dark, theme-color and the iPhone status bar style before first paint.
- `manifest.webmanifest`, `apple-touch-icon.png`, `icons/`: home-screen app and the paddle icon
- `api/tournaments.js`: upcoming Michigan tournaments (cached 30 min at Vercel's edge; add `?debug=1` to see how the fetch went)
- `api/tournament.js`: one tournament's details + events (`?slug=midwest-open`)
- `api/_lib/pt.js`: pickleballtournaments.com helpers (finds the site's search action by name, parses tournament pages). Copied from Rally's rally-4 engine, not shared with it.
- `vercel.json`: time limits for the tournament routes, and `noindex` on every page so Bracket stays out of search results.

## On each phone (localStorage)
- `bracket_settings`: home location, rating, Fit for you on/off, List or Calendar, filters (incl. weekend / dates, level fit / up), looks, text size, Mine tab
- `bracket_saves`: `{ interested: {slug: snapshot}, registered: {slug: snapshot} }`
- `bracket_list`: last tournament list (opens instantly, shown if the data source is down)
- `bracket_details`: last 30 tournament details

## Links
- `/?t=<slug>` opens Bracket straight to a tournament.

## Vercel env vars
None needed.
- `PT_ACTION_ID` (optional, normally unset): pins pickleballtournaments.com's search action id by hand if finding it automatically ever breaks.

Env var changes need a Redeploy.

// api/tournaments.js
// Upcoming Michigan tournaments from pickleballtournaments.com.
// GET /api/tournaments            → { fetchedAt, items: [...] }
// GET /api/tournaments?debug=1    → same plus how it went (action id source, pages, timings)
//
// Vercel's edge keeps the answer for 30 minutes (and serves the old one while it refreshes),
// so Bracket opens fast and the site only gets asked a few times an hour, no matter how many
// people use Bracket. Don't lower the cache times.
import { getActionId, searchPage, getEvents, isMichigan, skillRange } from './_lib/pt.js';

export const config = { maxDuration: 45 };

const MAX_PAGES = 6;
const VERSION = 'bracket-10';

async function allPages(actionId, log){
  const first = await searchPage(actionId, 1);
  let items = first.items.slice();
  const pages = Math.min(MAX_PAGES, Math.ceil((first.totalCount || items.length) / 24) || 1);
  log.totalCount = first.totalCount;
  if(pages > 1){
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => searchPage(actionId, i + 2).then(r => r.items).catch(e => { log.pageErrors = (log.pageErrors || 0) + 1; return []; })));
    rest.forEach(r => { items = items.concat(r); });
  }
  log.pages = pages;
  return items;
}

// Run fn over items, a few at a time
async function pool(items, n, fn){
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while(i < items.length){ const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function summarizeEvents(events){
  const formats = new Set(), skills = new Map(), ages = new Set(), days = new Set();
  const byFormat = {};   // level ranges per format, so Bracket can use your mixed / singles rating for those events
  let timed = false, registered = 0;
  events.forEach(e => {
    if(e.canceled) return;
    const fmt = /team/i.test(e.group + ' ' + e.title) ? 'Team' : /mixed/i.test(e.players) ? 'Mixed' : /singles/i.test(e.format) ? 'Singles' : 'Doubles';
    formats.add(fmt);
    const r = skillRange(e.skill);
    if(r){
      skills.set(r.lo + '-' + r.hi, [r.lo, r.hi]);
      const list = byFormat[fmt] = byFormat[fmt] || [];
      if(!list.some(x => x[0] === r.lo && x[1] === r.hi)) list.push([r.lo, r.hi]);
    }
    if(e.age) ages.add(e.age);
    if(/\d{1,2}:\d{2}\s*[AP]M/i.test(e.date)) timed = true;
    const d = e.date.match(/^[A-Za-z]{3} \d{1,2} \d{4}/);
    if(d) days.add(d[0]);
    registered += e.registered;
  });
  return { n: events.filter(e => !e.canceled).length, formats: [...formats], skills: [...skills.values()], byFormat, ages: [...ages].slice(0, 12), timed, registered };
}

export default async function handler(req, res){
  const debug = req.query.debug === '1';
  const log = { app: 'bracket', version: VERSION, started: Date.now() };
  try {
    let a = await getActionId();
    log.action = a.source;
    let raw;
    try { raw = await allPages(a.id, log); }
    catch(e){
      // The site probably redeployed and the action id changed: find it again once
      log.retry = e.message;
      a = await getActionId(true);
      log.action = 'rediscovered';
      raw = await allPages(a.id, log);
    }
    const today = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // Michigan-ish "today"
    const seen = new Set();
    const mi = raw.filter(it => isMichigan(it) && !it.isCanceled && !seen.has(it.slug) && seen.add(it.slug))
      .filter(it => String(it.dateTo || it.dateFrom || '').slice(0, 10) >= today);
    log.michigan = mi.length;

    const sums = await pool(mi, 6, it => getEvents(it.slug).then(r => summarizeEvents(r.events)).catch(() => null));
    log.eventsFailed = sums.filter(x => !x).length;

    const items = mi.map((it, i) => ({
      slug: it.slug,
      title: String(it.title || '').trim(),
      startDay: String(it.dateFrom || '').slice(0, 10),   // the site stores local times with a Z, so use the date part
      endDay: String(it.dateTo || it.dateFrom || '').slice(0, 10),
      start: it.dateFrom || null,
      location: it.location || '',
      city: String(it.location || '').split(',')[0].trim(),
      lat: it.lat, lng: it.lng,
      price: typeof it.price === 'number' ? it.price : null,
      currency: it.currency || 'usd',
      costPerEvent: !!it.isCostPerEvent,
      free: !!it.isFree,
      prize: !!it.isPrizeMoney,
      regClosed: !!it.isRegistrationClosed,
      completed: !!it.isTournamentCompleted,
      advertised: !!it.isAdvertiseOnly,
      players: Number(it.registrationCount) || 0,
      playersHidden: !!it.hideRegisteredPlayers,
      status: it.status || '',
      logo: it.logo || null,
      ev: sums[i]
    })).sort((x, y) => x.startDay.localeCompare(y.startDay) || x.title.localeCompare(y.title));

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=43200');
    const body = { fetchedAt: new Date().toISOString(), items };
    if(debug){ log.ms = Date.now() - log.started; body.debug = log; }
    return res.status(200).json(body);
  } catch(err){
    res.setHeader('Cache-Control', 'no-store');
    const blocked = /HTTP 40[13]/.test(err.message);
    return res.status(502).json({
      error: blocked ? 'pickleballtournaments.com blocked the request' : 'Couldn’t read pickleballtournaments.com: ' + err.message,
      code: blocked ? 'blocked' : 'upstream',
      debug: debug ? { ...log, ms: Date.now() - log.started } : undefined
    });
  }
}

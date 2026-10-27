// api/_lib/pt.js
// Helpers for reading pickleballtournaments.com (Next.js site behind Amazon CloudFront).
// Bracket's own copy of Rally's rally-4 engine. Copied, not shared: when their site changes, fix Bracket first.
// Files under api/_lib are not routes.
//
// Where the data comes from (checked live Oct 23 + 26, 2026; details in claude/rally-build-log.md):
// - Tournament list: the site's "getTournaments" server action. POST /search with a
//   `next-action: <id>` header. The id changes when the site redeploys, so we find it by
//   name in the JavaScript files the /search page loads, and remember it.
// - Events in a tournament: GET /tournaments/api/tourneyEvents?slug=<slug> (plain JSON).
// - Tournament page: GET /tournaments/<slug>; its data sits in self.__next_f.push(...) chunks.

export const PT = 'https://pickleballtournaments.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// Michigan, seen from the middle of the Lower Peninsula at a zoom that covers the whole state
export const MI_CENTER = { lat: 44.3, lng: -85.4 };
export const MI_ZOOM = 6;

export async function ptFetch(url, opts = {}, timeoutMs = 12000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) }
    });
  } finally { clearTimeout(t); }
}

// ---------- Server action id ----------
// Kept in memory while this Vercel instance is warm. PT_ACTION_ID (env) can pin one by hand.
let actionCache = { id: null, at: 0, source: '' };
const ACTION_RE = /createServerReference\)\("([0-9a-f]{40,44})",[^)]*?"getTournaments"\)/;

export async function getActionId(force = false){
  if(!force && process.env.PT_ACTION_ID && !actionCache.failedEnv) return { id: process.env.PT_ACTION_ID.trim(), source: 'env' };
  if(!force && actionCache.id && Date.now() - actionCache.at < 6 * 3600 * 1000) return { id: actionCache.id, source: 'cache' };
  const r = await ptFetch(PT + '/search', { headers: { Accept: 'text/html' } });
  if(!r.ok) throw new Error('search page HTTP ' + r.status);
  const html = await r.text();
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'\s]+?\.js/g)].map(m => m[0]))];
  // Shared chunks (numbered like 8023-xxxx.js) hold the action; look at those first
  srcs.sort((a, b) => (/chunks\/\d+-/.test(b) ? 1 : 0) - (/chunks\/\d+-/.test(a) ? 1 : 0));
  for(let i = 0; i < srcs.length; i += 8){
    const batch = srcs.slice(i, i + 8);
    const texts = await Promise.all(batch.map(s => ptFetch(PT + s, {}, 8000).then(x => x.ok ? x.text() : '').catch(() => '')));
    for(const t of texts){
      const m = t.match(ACTION_RE);
      if(m){ actionCache = { id: m[1], at: Date.now(), source: 'found' }; return { id: m[1], source: 'found' }; }
    }
  }
  throw new Error('getTournaments action not found in ' + srcs.length + ' scripts');
}

function searchState(page){
  return {
    keyword: null, showAll: false, locationType: 'current',
    placeKeyword: 'Michigan, United States', place: { formatted_address: 'Michigan, United States' },
    center: MI_CENTER, bounds: null, googlePlaceId: null, dateFrom: null, dateTo: null, pastTours: false,
    zoomLevel: MI_ZOOM, currentPage: page, tournamentFilter: null, partner: null, clubId: null, loading: true,
    userLocation: { query: '', lat: MI_CENTER.lat, lng: MI_CENTER.lng, city: 'Michigan', region: 'United States', country: 'United States' }
  };
}

// One page (24 tournaments) of the search. Returns { items, totalCount }.
export async function searchPage(actionId, page){
  const r = await ptFetch(PT + '/search', {
    method: 'POST',
    headers: { Accept: 'text/x-component', 'next-action': actionId, 'Content-Type': 'text/plain;charset=UTF-8', Origin: PT, Referer: PT + '/search' },
    body: JSON.stringify([searchState(page)])
  });
  if(!r.ok) throw Object.assign(new Error('search HTTP ' + r.status), { status: r.status });
  const text = await r.text();
  const line = text.split('\n').find(l => /^1:/.test(l));
  if(!line) throw new Error('unexpected search reply: ' + text.slice(0, 120));
  const j = JSON.parse(line.slice(2));
  if(!j || !j.data || !Array.isArray(j.data.items)) throw new Error('search error: ' + (j && j.error ? j.error : 'no items'));
  return { items: j.data.items, totalCount: j.data.totalCount || 0 };
}

// ---------- Events (divisions) ----------
export async function getEvents(slug){
  const r = await ptFetch(PT + '/tournaments/api/tourneyEvents?' + new URLSearchParams({ slug, searchTerm: '', needAPartnerOnly: 'false' }), { headers: { Accept: 'application/json' } }, 9000);
  if(!r.ok) throw new Error('events HTTP ' + r.status);
  const j = await r.json();
  const groups = Array.isArray(j.events) ? j.events : [];
  return {
    playerCountHidden: !!j.tourneyPlayerCountHidden,
    events: groups.flatMap(g => (g.events || []).map(e => ({
      id: e.eventId != null ? String(e.eventId) : '',   // stable id, used for "your events" picks
      group: String(g.groupTitle || ''),
      title: String(e.title || ''),
      players: String(e.playerGroup || ''),     // Mens | Womens | Mixed | Coed
      format: String(e.format || ''),           // Doubles | Singles
      skill: String(e.skillGroup || ''),        // "3.5", "3.0 To 3.5", "4.5 And Above", "Open"
      age: String(e.ageGroup || ''),
      date: String(e.date || ''),               // "Nov 13 2026 3:00 PM" (time only once posted)
      bracket: String(e.bracketType || ''),
      registered: Number(e.numOfRegistered) || 0,
      waitlist: Number(e.numOfWaitlist) || 0,
      max: Number(e.maxNumOfTeams) || 0,
      waitlistOpen: !!e.waitlistActive,
      canceled: !!e.isCanceled,
      status: e.status && e.status.text ? String(e.status.text) : ''
    })))
  };
}

// ---------- Tournament page ----------
// Next.js streams page data as self.__next_f.push([1,"..."]) strings. Join them, then
// pull out the fields we use. Long texts are stored as "$4a" references to a "4a:T<hexlen>," chunk.
export function nextData(html){
  return [...String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map(m => { try { return JSON.parse('"' + m[1] + '"'); } catch(e){ return ''; } })
    .join('');
}
function strAt(data, key, from = 0){
  const re = new RegExp('"' + key + '":("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)', 'g');
  re.lastIndex = from;
  const m = re.exec(data);
  if(!m) return null;
  try { return JSON.parse(m[1]); } catch(e){ return null; }
}
function arrayAt(data, key, from = 0){
  const i = data.indexOf('"' + key + '":[', from);
  if(i < 0) return null;
  let depth = 0, start = data.indexOf('[', i), inStr = false;
  for(let j = start; j < data.length; j++){
    const c = data[j];
    if(inStr){ if(c === '\\'){ j++; continue; } if(c === '"') inStr = false; continue; }
    if(c === '"') inStr = true;
    else if(c === '[' || c === '{') depth++;
    else if(c === ']' || c === '}'){ depth--; if(depth === 0){ try { return JSON.parse(data.slice(start, j + 1)); } catch(e){ return null; } } }
  }
  return null;
}
function textRef(data, ref){
  const m = /^\$([0-9a-f]+)$/.exec(String(ref || ''));
  if(!m) return ref || '';
  const head = new RegExp('(?:^|\\n)' + m[1] + ':T([0-9a-f]+),').exec(data);
  if(!head) return '';
  const len = parseInt(head[1], 16);
  const startChar = head.index + head[0].length;
  const bytes = Buffer.from(data.slice(startChar, startChar + len + 64), 'utf8');
  return bytes.subarray(0, len).toString('utf8');
}

export async function getTournamentPage(slug){
  const r = await ptFetch(PT + '/tournaments/' + encodeURIComponent(slug), { headers: { Accept: 'text/html' } });
  if(r.status === 404) return null;
  if(!r.ok) throw new Error('tournament page HTTP ' + r.status);
  return parseTournamentPage(await r.text());
}

export function parseTournamentPage(html){
  const data = nextData(html);
  const td = data.indexOf('"tourneyDates"');
  const ti = td > 0 ? data.lastIndexOf('"title":', td) : -1;
  const at = ti >= 0 && td - ti < 4000 ? ti : Math.max(0, td - 3000); // the tournament's own data block
  const s = k => strAt(data, k, at);
  const loc = (arrayAt(data, 'locations', at) || []).find(l => l && l.IsPrimary) || (arrayAt(data, 'locations', at) || [])[0] || null;
  const costs = (arrayAt(data, 'costsData', at) || []).map(c => ({
    title: c.Title || '', price: parseFloat(c.Cost_Registration) || 0, from: c.DateStart_UTC || c.DateStart || null, current: !!c.IsCurrent
  }));
  const out = {
    title: s('title'),
    status: s('status'),
    players: s('numOfPlayers'),
    dates: s('tourneyDates'),
    regOpen: [s('regOpenDate'), s('regOpenTime')].filter(Boolean).join(' '),
    regClose: [s('regCloseDate'), s('regCloseTime')].filter(Boolean).join(' '),
    price: s('currentRegPrice'),
    costs,
    venue: (loc && loc.Venue) || s('venueName'),
    street: (loc && loc.StreetAddress) || s('street'),
    cityStateZip: s('cityStateZip') || (loc ? [loc.City, loc.StateAbbreviation].filter(Boolean).join(', ') + (loc.Zip ? ' ' + loc.Zip : '') : null),
    lat: loc && loc.Latitude ? parseFloat(loc.Latitude) : null,
    lng: loc && loc.Longitude ? parseFloat(loc.Longitude) : null,
    playArea: loc ? loc.PlayAreaTypeTitle || null : null,   // e.g. "Indoor Air Conditioned"
    surface: loc ? loc.SurfaceTypeTitle || null : null,
    courts: loc ? loc.NumberOfCourts || null : null,
    ball: loc ? loc.BallUsed || null : null,
    website: s('website'),
    timezone: s('timezoneAbbr'),
    startTimesPosted: s('startTimesPosted'),
    prizeInfo: s('prizeInfo'),
    description: textRef(data, s('description')).slice(0, 6000),
    additionalInfo: s('additionalInfo')
  };
  // The site writes "$undefined" / "Not Specified" for empty fields
  Object.keys(out).forEach(k => {
    const v = out[k];
    if(v === '' || v == null || v === '$undefined' || (typeof v === 'string' && /^not specified$/i.test(v.trim()))) delete out[k];
  });
  return out;
}

// "3.5" → 3.5–3.99, "3.0 To 3.5" → 3.0–3.5, "4.5 And Above" → 4.5–9, "Open" → open
export function skillRange(s){
  s = String(s || '').trim();
  if(!s) return null;
  if(/^open/i.test(s)) return { lo: 0, hi: 9, open: true };
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0 && n < 9);
  if(!nums.length) return null;
  if(/and\s*(above|up|over)|\+/i.test(s)) return { lo: nums[0], hi: 9 };
  if(/and\s*(below|under)/i.test(s)) return { lo: 0, hi: nums[0] };
  if(nums.length >= 2) return { lo: nums[0], hi: nums[1] };
  return { lo: nums[0], hi: nums[0] + 0.49 };
}

export function isMichigan(item){ return /,\s*MI,/i.test(String(item.location || '')); }

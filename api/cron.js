// api/cron.js
// The hourly notification check. Supabase (pg_cron, 5-notify-job.sql) calls this every hour at :07
// with the CRON_SECRET header. Add ?force=1 to ignore quiet hours when testing.
//
// For everyone with notifications on, it looks at their saved tournaments and sends at most one
// alert per tournament per day, and only between 9am and 8pm Michigan time:
//   tomorrow  – a tournament you marked registered starts tomorrow
//   closing   – registration closes within 2 days (saved, not marked registered)
//   early     – the price goes up within a day (early-bird ending)
//   changes   – price, dates or registration changed since you last looked (off by default)
//   partner   – someone asked to team up with you (any time between 9 and 8)
import { getTournamentPage } from './_lib/pt.js';
import { origin } from './_lib/find.js';
import { sbReady, sbGet, sbInsertNew, sbDelete } from './_lib/sb.js';
import { pushReady, sendPush } from './_lib/push.js';

export const config = { maxDuration: 60 };

export const DEFAULTS = { partner: true, tomorrow: true, closing: true, early: true, changes: false };
const TZ = 'America/Detroit';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function etParts(d){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
}
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const fmtDay = ymd => { const [y, m, d] = ymd.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
// "Nov 10 2026 10:00 PM EST" → ms (treated as Michigan time)
function ptTime(s){
  const m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i.exec(String(s || ''));
  if(!m) return null;
  const mi = MON.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if(mi < 0) return null;
  let h = 23, min = 59;
  if(m[4]){ h = +m[4] % 12 + (/p/i.test(m[6]) ? 12 : 0); min = +m[5]; }
  const guess = Date.UTC(+m[3], mi, +m[2], h + 5, min);           // EST = UTC-5
  const off = etParts(new Date(guess)).hour !== (h % 24) ? 1 : 0;  // daylight time = UTC-4
  return guess - off * 3600 * 1000;
}
const money = n => '$' + Math.round(n);

// Pick at most one alert for one saved tournament
export function alertFor({ t, snap, registered, det, prefs, now, today }){
  const on = k => { if(snap && snap.alerts === 'off') return false; const a = snap && snap.alerts && typeof snap.alerts === 'object' ? snap.alerts : {}; return a[k] != null ? !!a[k] : !!prefs[k]; };
  if(!t) return null;
  const title = t.title || snap.title || 'Your tournament';
  const url = '/t/' + t.slug;
  const tomorrow = addDays(today, 1);
  if(registered && on('tomorrow') && t.startDay === tomorrow)
    return { kind: 'tomorrow', key: t.startDay, title: 'Tomorrow: ' + title, body: `${t.city ? t.city + ' · ' : ''}Good luck! Check start times before you go.`, url };
  if(t.startDay < today) return null;
  if(!registered && on('closing') && det && det.regClose && !t.regClosed){
    const close = ptTime(det.regClose);
    if(close && close > now && close - now <= 48 * 3600 * 1000){
      const d = new Date(close), et = etParts(d);
      return { kind: 'closing', key: String(det.regClose), title: 'Registration closes soon', body: `${title}: sign-up closes ${WD[new Date(et.ymd + 'T12:00:00Z').getUTCDay()]}, ${fmtDay(et.ymd)}.`, url };
    }
  }
  if(on('early') && det && det.costs && det.costs.length){
    const cur = (() => { const m = /\$\s*([\d,.]+)/.exec(String(det.price || '')); return m ? parseFloat(m[1].replace(/,/g, '')) : t.price; })();
    const next = det.costs.filter(c => c.from && Date.parse(c.from) > now && c.price > (cur || 0)).sort((a, b) => Date.parse(a.from) - Date.parse(b.from))[0];
    if(next && Date.parse(next.from) - now <= 30 * 3600 * 1000)
      return { kind: 'early', key: String(next.from), title: 'Early-bird price ends soon', body: `${title}: ${cur != null ? money(cur) + ' now, ' : ''}${money(next.price)} starting ${fmtDay(etParts(new Date(Date.parse(next.from))).ymd)}.`, url };
  }
  if(on('changes') && snap){
    const parts = [];
    if(t.price != null && snap.price != null && Math.round(t.price) !== Math.round(snap.price)) parts.push(t.price > snap.price ? `price went up to ${money(t.price)}` : `price dropped to ${money(t.price)}`);
    if(t.startDay !== snap.startDay || (t.endDay || t.startDay) !== (snap.endDay || snap.startDay)) parts.push(`dates changed to ${fmtDay(t.startDay)}${t.endDay && t.endDay !== t.startDay ? '–' + fmtDay(t.endDay) : ''}`);
    if(!!t.regClosed !== !!snap.regClosed) parts.push(t.regClosed ? 'registration closed' : 'registration reopened');
    if(parts.length) return { kind: 'changes', key: [t.price, t.startDay, t.endDay, !!t.regClosed].join('|'), title: title + ' changed', body: parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.', url };
  }
  return null;
}

async function pool(items, n, fn){
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while(i < items.length){ const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

export default async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  const secret = String(process.env.CRON_SECRET || '');
  if(!secret || (req.headers['x-cron-secret'] !== secret && req.query.secret !== secret)) return res.status(401).json({ error: 'Not allowed' });
  if(!sbReady() || !pushReady()) return res.status(503).json({ error: 'Notifications aren’t set up yet (Supabase or VAPID env vars missing).' });
  const now = Date.now(), et = etParts(new Date(now)), today = et.ymd;
  if((et.hour < 9 || et.hour >= 20) && req.query.force !== '1') return res.status(200).json({ skipped: 'quiet hours', hour: et.hour });
  const log = { users: 0, candidates: 0, sent: 0, gone: 0, errors: 0, details: 0 };
  try {
    const subs = await sbGet('bracket_push_subs?select=id,user_id,endpoint,p256dh,auth');
    const uids = [...new Set(subs.map(s => s.user_id))];
    log.users = uids.length;
    if(!uids.length) return res.status(200).json(log);
    const inList = 'in.(' + uids.join(',') + ')';
    const [profiles, saves, reqs] = await Promise.all([
      sbGet(`bracket_profile?select=user_id,notify&user_id=${inList}`),
      sbGet(`bracket_saves?select=user_id,kind,slug,snap&user_id=${inList}`),
      sbGet(`bracket_partner_requests?select=id,to_user,from_name,post_id,status,created_at&status=eq.sent&to_user=${inList}`).catch(() => [])
    ]);
    const posts = reqs.length ? await sbGet(`bracket_partner_posts?select=id,event,title,slug&id=in.(${[...new Set(reqs.map(r => r.post_id))].join(',')})`).catch(() => []) : [];
    const prefsOf = {}; profiles.forEach(p => { prefsOf[p.user_id] = Object.assign({}, DEFAULTS, p.notify || {}); });
    const list = await fetch(origin(req) + '/api/tournaments').then(r => r.json()).then(j => j.items || []).catch(() => []);
    const bySlug = Object.fromEntries(list.map(t => [t.slug, t]));
    // Tournament pages only for saved tournaments that might need a closing / early-bird alert (cost tiers, close date)
    const needDet = [...new Set(saves.filter(s => bySlug[s.slug] && bySlug[s.slug].startDay >= today).map(s => s.slug))].slice(0, 40);
    const dets = await pool(needDet, 4, slug => getTournamentPage(slug));
    const detOf = {}; needDet.forEach((s, i) => { if(dets[i]) detOf[s] = dets[i]; });
    log.details = Object.keys(detOf).length;

    const candidates = [];
    uids.forEach(uid => {
      const prefs = prefsOf[uid] || Object.assign({}, DEFAULTS);
      const mine = {};
      saves.filter(s => s.user_id === uid).forEach(s => {
        const m = mine[s.slug] = mine[s.slug] || { snap: null, registered: false };
        if(s.kind === 'registered') m.registered = true;
        m.snap = Object.assign({}, m.snap || {}, s.snap || {});
      });
      Object.entries(mine).forEach(([slug, m]) => {
        const a = alertFor({ t: bySlug[slug], snap: m.snap, registered: m.registered, det: detOf[slug], prefs, now, today });
        if(a) candidates.push(Object.assign({ user_id: uid, slug }, a));
      });
      if(prefs.partner) reqs.filter(r => r.to_user === uid).forEach(r => {
        const p = posts.find(x => x.id === r.post_id) || {};
        candidates.push({ user_id: uid, slug: p.slug || 'partner', kind: 'partner', key: r.id, title: `${r.from_name} wants to team up`, body: `${p.event || 'Your partner post'}${p.title ? ' · ' + p.title : ''}. Open Bracket to see how to reach them.`, url: '/?mine=1' });
      });
    });
    log.candidates = candidates.length;
    // One tournament alert per tournament per day: skip if anything for that tournament went out in the last 20 hours
    const recent = candidates.length ? await sbGet(`bracket_push_log?select=user_id,slug,kind,sent_at&user_id=${inList}&sent_at=gte.${new Date(now - 20 * 3600 * 1000).toISOString()}`) : [];
    const fresh = candidates.filter(c => c.kind === 'partner' || !recent.some(r => r.user_id === c.user_id && r.slug === c.slug && r.kind !== 'partner'));
    const inserted = await sbInsertNew('bracket_push_log', fresh.map(c => ({ user_id: c.user_id, slug: c.slug, kind: c.kind, key: c.key })));
    const isNew = c => inserted.some(r => r.user_id === c.user_id && r.slug === c.slug && r.kind === c.kind && r.key === c.key);
    const goneIds = new Set();
    for(const c of fresh.filter(isNew)){
      for(const sub of subs.filter(s => s.user_id === c.user_id)){
        const r = await sendPush(sub, { title: c.title, body: c.body, url: c.url, tag: c.kind + ':' + c.slug });
        if(r === 'ok') log.sent++; else if(r === 'gone'){ log.gone++; goneIds.add(sub.id); } else log.errors++;
      }
    }
    if(goneIds.size) await sbDelete(`bracket_push_subs?id=in.(${[...goneIds].join(',')})`).catch(() => {});
    return res.status(200).json(log);
  } catch(e){
    return res.status(502).json(Object.assign(log, { error: e.message }));
  }
}

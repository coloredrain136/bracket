// api/_lib/find.js
// Look up one tournament for the share page and the calendar file.
// First from Bracket's own /api/tournaments (cached at Vercel's edge, so this costs
// pickleballtournaments.com nothing), then from the tournament page itself.
import { getTournamentPage } from './pt.js';

export const APP_VERSION = 'bracket-15';   // keep in step with VERSION in index.html

export function origin(req){
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return proto.split(',')[0] + '://' + host;
}

export async function fromList(req, slug){
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(origin(req) + '/api/tournaments', { signal: ctrl.signal });
    clearTimeout(t);
    if(!r.ok) return null;
    const j = await r.json();
    return (j.items || []).find(x => x.slug === slug) || null;
  } catch(e){ return null; }
}

export async function fromPage(slug){
  try { return await getTournamentPage(slug); } catch(e){ return null; }
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtSpan(a, b){
  if(!a) return '';
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = (b || a).split('-').map(Number);
  if(a === (b || a)) return `${MON[m1 - 1]} ${d1}`;
  return m1 === m2 ? `${MON[m1 - 1]} ${d1}–${d2}` : `${MON[m1 - 1]} ${d1} – ${MON[m2 - 1]} ${d2}`;
}

export const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const goodSlug = s => /^[a-z0-9][a-z0-9-]{1,140}$/i.test(String(s || ''));

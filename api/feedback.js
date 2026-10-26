// api/feedback.js
// POST { kind, message, contact, website } → saved to bracket_feedback in Supabase.
// Read it in Supabase → Table Editor → bracket_feedback. "website" is a hidden trap field for bots.
import { sbReady, sbInsert } from './_lib/sb.js';
import { APP_VERSION } from './_lib/find.js';

const KINDS = ['idea', 'problem', 'missing', 'other'];
const hits = new Map(); // per-IP, per warm instance: max 5 in 10 minutes

export default async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if(!sbReady()) return res.status(503).json({ error: 'Feedback isn’t set up yet.' });
  let b = req.body || {};
  if(typeof b === 'string'){ try { b = JSON.parse(b); } catch(e){ b = {}; } }
  if(b.website) return res.status(200).json({ ok: true }); // bot: pretend it worked
  const message = String(b.message || '').trim();
  const contact = String(b.contact || '').trim().slice(0, 200);
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  if(message.length < 3) return res.status(400).json({ error: 'Please write a little more.' });
  if(message.length > 2000) return res.status(400).json({ error: 'That’s a bit long. Please keep it under 2,000 characters.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if(list.length >= 5) return res.status(429).json({ error: 'Thanks! That’s a lot of feedback at once. Try again in a few minutes.' });
  list.push(now); hits.set(ip, list);
  try {
    await sbInsert('bracket_feedback', {
      kind, message, contact: contact || null,
      app_version: String(b.version || APP_VERSION).slice(0, 30),
      device: String(req.headers['user-agent'] || '').slice(0, 200)
    });
    return res.status(200).json({ ok: true });
  } catch(e){
    return res.status(502).json({ error: 'Couldn’t send that right now. Please try again later.' });
  }
}

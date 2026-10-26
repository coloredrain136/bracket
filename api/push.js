// api/push.js
// POST { action: "test" } with "Authorization: Bearer <access token>"
// Sends a test notification to every device where this person turned notifications on.
import { sbReady, sbUser, sbGet, sbDelete } from './_lib/sb.js';
import { pushReady, sendPush } from './_lib/push.js';

export default async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if(!sbReady() || !pushReady()) return res.status(503).json({ error: 'Notifications aren’t set up yet.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await sbUser(token).catch(() => null);
  if(!user) return res.status(401).json({ error: 'Please sign in again.' });
  const subs = await sbGet(`bracket_push_subs?select=id,endpoint,p256dh,auth&user_id=eq.${user.id}`).catch(() => []);
  if(!subs.length) return res.status(404).json({ error: 'No devices with notifications on yet.' });
  let sent = 0;
  for(const s of subs){
    const r = await sendPush(s, { title: 'Bracket notifications are on', body: 'You’ll hear about tournaments you saved: price changes, closing registration and more.', url: '/', tag: 'test' });
    if(r === 'ok') sent++;
    if(r === 'gone') await sbDelete(`bracket_push_subs?id=eq.${s.id}`).catch(() => {});
  }
  return res.status(200).json({ ok: sent > 0, sent, devices: subs.length });
}

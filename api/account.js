// api/account.js
// POST { action: "delete" } with "Authorization: Bearer <access token>"
// Deletes the signed-in person's account. Their saves and profile go with it (on delete cascade).
import { sbReady, sbUser, sbDeleteUser } from './_lib/sb.js';

export default async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if(!sbReady()) return res.status(503).json({ error: 'Accounts aren’t set up yet.' });
  let b = req.body || {};
  if(typeof b === 'string'){ try { b = JSON.parse(b); } catch(e){ b = {}; } }
  if(b.action !== 'delete') return res.status(400).json({ error: 'Unknown action' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await sbUser(token).catch(() => null);
  if(!user) return res.status(401).json({ error: 'Please sign in again, then try once more.' });
  try {
    await sbDeleteUser(user.id);
    return res.status(200).json({ ok: true });
  } catch(e){
    return res.status(502).json({ error: 'Couldn’t delete the account right now. Please try again later.' });
  }
}

// api/config.js
// Small settings the page asks for on open:
// - version: if the page is older than the server, it reloads itself once (stale home-screen apps)
// - feedback: link to the Google Form (Vercel env var FEEDBACK_URL; hidden when not set)
import { APP_VERSION } from './_lib/find.js';

export default function handler(req, res){
  const fb = String(process.env.FEEDBACK_URL || '').trim();
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  return res.status(200).json({
    version: APP_VERSION,
    feedback: /^https:\/\//i.test(fb) ? fb : null
  });
}

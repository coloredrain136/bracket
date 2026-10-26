// api/config.js
// Small settings the page asks for on open:
// - version: if the page is older than the server, it reloads itself once (stale home-screen apps)
// - supabase: project URL + publishable key for Google sign-in and synced saves (safe to share:
//   Row Level Security keeps everyone to their own rows). Null until the env vars are set.
import { APP_VERSION } from './_lib/find.js';
import { SB_URL, SB_PUB } from './_lib/sb.js';

export default function handler(req, res){
  const url = SB_URL(), key = SB_PUB();
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  return res.status(200).json({
    version: APP_VERSION,
    supabase: /^https:\/\//.test(url) && key ? { url, key } : null,
    feedback: !!(url && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    push: String(process.env.VAPID_PUBLIC_KEY || '').trim() || null
  });
}

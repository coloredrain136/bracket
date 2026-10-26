// api/_lib/sb.js
// Minimal Supabase calls from the server, using fetch (no npm packages needed).
// Env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (also sent to the browser), SUPABASE_SECRET_KEY (server only).

export const SB_URL = () => String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
export const SB_PUB = () => String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const SB_SECRET = () => String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const sbReady = () => !!(SB_URL() && SB_SECRET());

// New-style keys (sb_secret_…) go in the apikey header only; old JWT keys also go in Authorization.
function adminHeaders(extra = {}){
  const k = SB_SECRET();
  const h = { apikey: k, 'Content-Type': 'application/json', ...extra };
  if(k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
  return h;
}

export async function sbInsert(table, row){
  const r = await fetch(`${SB_URL()}/rest/v1/${table}`, { method: 'POST', headers: adminHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(row) });
  if(!r.ok) throw new Error('insert ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

// Who is this? Checks a signed-in user's access token with Supabase Auth.
export async function sbUser(token){
  if(!token) return null;
  const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_PUB() || SB_SECRET(), Authorization: 'Bearer ' + token } });
  if(!r.ok) return null;
  const j = await r.json();
  return j && j.id ? j : null;
}

export async function sbDeleteUser(id){
  const r = await fetch(`${SB_URL()}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: adminHeaders() });
  if(!r.ok && r.status !== 404) throw new Error('delete user ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

// Server-side reads/writes with the secret key (bypasses Row Level Security; server only)
export async function sbGet(path){
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, { headers: adminHeaders() });
  if(!r.ok) throw new Error('get ' + path.split('?')[0] + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
// Insert rows, skipping ones that already exist; returns only the rows that were new
export async function sbInsertNew(table, rows){
  if(!rows.length) return [];
  const r = await fetch(`${SB_URL()}/rest/v1/${table}`, { method: 'POST', headers: adminHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify(rows) });
  if(!r.ok) throw new Error('insert ' + table + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
export async function sbDelete(path){
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, { method: 'DELETE', headers: adminHeaders() });
  if(!r.ok) throw new Error('delete ' + r.status);
}

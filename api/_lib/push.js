// api/_lib/push.js
// Sends Web Push notifications (iPhone Home Screen apps on iOS 16.4+, Android Chrome, desktop browsers).
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (keys are in the build's env-vars.txt).
import webpush from 'web-push';

let ready = false;
export function pushReady(){
  if(ready) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if(!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://bracket.vercel.app', pub.trim(), priv.trim());
  ready = true;
  return true;
}

// Returns 'ok', 'gone' (that phone turned notifications off: delete it) or 'error'
export async function sendPush(sub, msg){
  const send = globalThis.__bracketTestSend || ((s, body, o) => webpush.sendNotification(s, body, o));
  try {
    await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: 'normal' });
    return 'ok';
  } catch(e){
    return e && (e.statusCode === 404 || e.statusCode === 410) ? 'gone' : 'error';
  }
}

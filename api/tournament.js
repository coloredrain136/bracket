// api/tournament.js
// One tournament: its page details plus every event (division).
// GET /api/tournament?slug=midwest-open → { slug, url, detail: {...}, events: [...] }
import { PT, getTournamentPage, getEvents } from './_lib/pt.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res){
  const slug = String(req.query.slug || '');
  if(!/^[a-z0-9][a-z0-9-]{1,140}$/i.test(slug)){
    return res.status(400).json({ error: 'Bad slug', code: 'bad_request' });
  }
  const [page, ev] = await Promise.allSettled([getTournamentPage(slug), getEvents(slug)]);
  if(page.status === 'fulfilled' && page.value === null){
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'That tournament isn’t on pickleballtournaments.com anymore', code: 'not_found' });
  }
  if(page.status === 'rejected' && ev.status === 'rejected'){
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Couldn’t read pickleballtournaments.com: ' + page.reason.message, code: 'upstream' });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({
    slug,
    url: PT + '/tournaments/' + slug,
    eventsUrl: PT + '/tournaments/' + slug + '/events',
    detail: page.status === 'fulfilled' ? page.value : null,
    detailError: page.status === 'rejected' ? page.reason.message : undefined,
    events: ev.status === 'fulfilled' ? ev.value.events : [],
    playerCountHidden: ev.status === 'fulfilled' ? ev.value.playerCountHidden : false,
    eventsError: ev.status === 'rejected' ? ev.reason.message : undefined
  });
}

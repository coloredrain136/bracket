// api/ics.js
// A calendar file for one tournament: GET /api/ics?slug=midwest-open
// iPhone opens it straight into "Add to Calendar". All-day event(s) for the tournament dates.
import { PT } from './_lib/pt.js';
import { fromList, fromPage, goodSlug } from './_lib/find.js';

const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes must be folded
function fold(line){
  const out = []; let cur = '';
  for(const ch of line){
    if(Buffer.byteLength(cur + ch) > 74){ out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
function nextDay(ymd){
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

export default async function handler(req, res){
  const slug = String(req.query.slug || '');
  if(!goodSlug(slug)) return res.status(400).send('Bad slug');
  const [it, d] = await Promise.all([fromList(req, slug), fromPage(slug)]);
  if(!it || !it.startDay){
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('That tournament isn’t in Bracket’s upcoming list.');
  }
  const url = PT + '/tournaments/' + slug;
  const where = d ? [d.venue, d.street, d.cityStateZip].filter(Boolean).join(', ') : '';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bracket//Michigan pickleball tournaments//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + slug + '@bracket',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
    'DTSTART;VALUE=DATE:' + it.startDay.replace(/-/g, ''),
    'DTEND;VALUE=DATE:' + nextDay(it.endDay || it.startDay).replace(/-/g, ''),
    'SUMMARY:' + icsText('🏓 ' + it.title),
    'LOCATION:' + icsText(where || it.location || ''),
    'DESCRIPTION:' + icsText('Pickleball tournament. Details and registration: ' + url + '\n\nAdded from Bracket (unofficial). Check start times on pickleballtournaments.com.'),
    'URL:' + url,
    'TRANSP:TRANSPARENT',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${slug}.ics"`);
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(lines.map(fold).join('\r\n') + '\r\n');
}

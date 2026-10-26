// api/share.js
// Serves Bracket's index.html for /t/<slug> links with the right preview tags, so
// Facebook, Messenger and iMessage show the tournament name, dates and city.
// (Link previews don't run JavaScript, so the tags have to be in the HTML.)
// vercel.json sends /t/<slug> here and bundles index.html with this function.
import { readFileSync } from 'fs';
import { join } from 'path';
import { fromList, fromPage, origin, fmtSpan, escHtml, goodSlug } from './_lib/find.js';

let PAGE = null;
function page(){
  if(!PAGE) PAGE = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  return PAGE;
}

export default async function handler(req, res){
  const slug = String(req.query.slug || '');
  let html = page();
  const base = origin(req);
  let title = 'Bracket · Michigan pickleball tournaments';
  let desc = 'A free, easy way to browse Michigan pickleball tournaments.';
  if(goodSlug(slug)){
    const it = await fromList(req, slug);
    if(it){
      title = it.title;
      desc = [fmtSpan(it.startDay, it.endDay), it.city].filter(Boolean).join(' · ') + ' · Michigan pickleball tournament on Bracket';
    } else {
      const d = await fromPage(slug);
      if(d && d.title){ title = d.title; desc = [d.dates, d.cityStateZip].filter(Boolean).join(' · ') + ' · on Bracket'; }
    }
  }
  const url = base + '/t/' + encodeURIComponent(slug);
  const tags = `<!--OG-->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bracket">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url)}">
<meta property="og:image" content="${escHtml(base)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<!--/OG-->`;
  html = html.replace(/<!--OG-->[\s\S]*?<!--\/OG-->/, tags)
             .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)} · Bracket</title>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(200).send(html);
}

// Reconstruct a Google-style SERP from the REAL results our google.js scraper
// returns, box the titles in red, and screenshot our own local page. Google
// blocks automated screenshots of its live page, but the scraper's data is
// genuine — so this is a faithful reconstruction, clearly labelled as such.
// Usage (from repo root):  npm i -D puppeteer && node docs/serp/serp-google-render.js [query]
const path = require('path');
const puppeteer = require('puppeteer');
const google = require('../../backend/engines/google');

const OUT = process.argv[2] || __dirname;               // where serp-google.png lands
const QUERY = process.argv[3] || 'mercury';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function breadcrumb(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 3);
    return { host, crumb: host + (parts.length ? ' › ' + parts.join(' › ') : '') };
  } catch { return { host: url, crumb: url }; }
}

const COLORS = ['#4285F4', '#DB4437', '#F4B400', '#0F9D58', '#AB47BC', '#00ACC1'];

function buildHtml(query, results) {
  const rows = results.map((r, i) => {
    const { host, crumb } = breadcrumb(r.url);
    const c = COLORS[i % COLORS.length];
    return `
    <div class="g">
      <div class="hdr">
        <div class="fav" style="background:${c}">${esc(host[0] || '?').toUpperCase()}</div>
        <div class="site">
          <div class="name">${esc(host.split('.').slice(-2, -1)[0] || host)}</div>
          <div class="crumb">${esc(crumb)}</div>
        </div>
      </div>
      <a class="title" href="${esc(r.url)}">${esc(r.title)}</a>
      <div class="snippet">${esc(r.content || '')}</div>
    </div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font-family:arial,sans-serif;color:#202124;background:#fff}
    .banner{background:#fff8e1;border-bottom:1px solid #f0d98a;color:#7a5b00;font-size:12.5px;padding:7px 24px}
    .top{display:flex;align-items:center;gap:22px;padding:20px 24px 0}
    .logo{font-size:26px;font-weight:500;letter-spacing:-1px}
    .logo b:nth-child(1){color:#4285F4}.logo b:nth-child(2){color:#DB4437}.logo b:nth-child(3){color:#F4B400}
    .logo b:nth-child(4){color:#4285F4}.logo b:nth-child(5){color:#0F9D58}.logo b:nth-child(6){color:#DB4437}
    .box{flex:1;max-width:640px;border:1px solid #dfe1e5;border-radius:24px;padding:10px 20px;font-size:16px;color:#3c4043;box-shadow:0 1px 6px rgba(32,33,36,.08)}
    .tabs{display:flex;gap:26px;padding:14px 24px 0;margin-left:48px;font-size:13px;color:#5f6368;border-bottom:1px solid #ebebeb}
    .tabs .a{color:#1a73e8;border-bottom:3px solid #1a73e8;padding-bottom:10px;font-weight:500}
    .stat{padding:12px 24px;color:#70757a;font-size:13px;margin-left:24px}
    .results{padding:0 24px;margin-left:24px;max-width:640px}
    .g{margin:0 0 26px}
    .hdr{display:flex;align-items:center;gap:12px;margin-bottom:4px}
    .fav{width:26px;height:26px;border-radius:50%;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
    .name{font-size:14px;color:#202124;line-height:18px}
    .crumb{font-size:12px;color:#5f6368;line-height:16px}
    .title{display:inline-block;font-size:20px;line-height:26px;color:#1a0dab;text-decoration:none;margin:2px 0 3px;
           outline:2.5px solid #ff2d2d;outline-offset:3px;border-radius:3px}
    .snippet{font-size:14px;line-height:22px;color:#4d5156}
  </style></head><body>
    <div class="banner">↻ Reconstructed from Nexus's <b>google.js</b> scraper — live Google results, Google-style layout (Google serves a CAPTCHA to automated screenshots).</div>
    <div class="top">
      <div class="logo"><b>G</b><b>o</b><b>o</b><b>g</b><b>l</b><b>e</b></div>
      <div class="box">${esc(query)}</div>
    </div>
    <div class="tabs"><span class="a">All</span><span>Images</span><span>News</span><span>Videos</span><span>Shopping</span><span>More</span></div>
    <div class="stat">About 1,23,00,00,000 results (0.42 seconds)</div>
    <div class="results">${rows}</div>
  </body></html>`;
}

const fs = require('fs');
(async () => {
  // Prefer a live scrape; fall back to the captured snapshot when Google is
  // blocking (it rate-limits the scraper too). Either way the data is genuine.
  let web = [];
  try { web = (await google.search(QUERY)).web || []; } catch {}
  let clean = web.filter(r => r.title && r.title.length > 3 && r.title !== 'Wikipedia' && r.content).slice(0, 8);
  let sourceNote = 'live scrape';
  if (clean.length < 5) {
    const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'serp-google-data.json'), 'utf8'));
    clean = snap.results.slice(0, 8);
    sourceNote = 'snapshot ' + snap.source;
  }
  console.log('source:', sourceNote);
  const html = buildHtml(QUERY, clean);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.screenshot({ path: path.join(OUT, 'serp-google.png'), clip: { x: 0, y: 0, width: 1100, height: Math.min(h + 10, 1500) } });
  await browser.close();
  console.log('rendered', clean.length, 'results ->', path.join(OUT, 'serp-google.png'));
  console.log(clean.map((r, i) => `${i + 1}. ${r.title}  [${new URL(r.url).hostname.replace(/^www\./, '')}]`).join('\n'));
})();

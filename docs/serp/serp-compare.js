/**
 * SERP divergence capture — annotates the top organic result titles of Google,
 * Bing and DuckDuckGo with red rectangles and saves one PNG per engine, to show
 * that different engines return different lists for the same query.
 *
 * Usage:
 *   npm i -D puppeteer          # not a runtime dependency of Nexus
 *   node docs/serp/serp-compare.js "mercury"
 *
 * Output: docs/serp/serp-<engine>.png  (+ the extracted title/domain list on stdout)
 *
 * Note: Google shows a reCAPTCHA to datacenter / flagged IPs. Run from a normal
 * residential connection if the Google capture comes back empty.
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const QUERY = process.argv[2] || 'mercury';
const OUT = __dirname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// Runs in the page: outlines the first N result-title nodes and drops a red box
// over each (the box survives late re-paints better when redrawn just before the
// shot). Returns [{rank,title,domain}] so the lists can be diffed, not just seen.
function overlay(selector, maxN) {
  document.querySelectorAll('.serp-hl').forEach(e => e.remove());
  const els = [...document.querySelectorAll(selector)].slice(0, maxN);
  return els.map((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    el.style.outline = '2.5px solid #ff2d2d';
    el.style.outlineOffset = '3px';
    el.style.borderRadius = '4px';
    const box = document.createElement('div');
    box.className = 'serp-hl';
    Object.assign(box.style, {
      position: 'absolute', left: (r.left + scrollX - 4) + 'px', top: (r.top + scrollY - 3) + 'px',
      width: (r.width + 8) + 'px', height: (r.height + 6) + 'px',
      border: '2.5px solid #ff2d2d', borderRadius: '4px', pointerEvents: 'none', zIndex: 2147483647
    });
    document.documentElement.appendChild(box);
    const a = el.href ? el : (el.closest('a') || el.querySelector('a'));
    const cite = el.closest('li, div')?.querySelector('cite');
    let domain = '';
    if (cite) domain = cite.innerText.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/ ›]/)[0];
    if (!domain) { try { domain = new URL(a.href).hostname.replace(/^www\./, ''); } catch {} }
    return { rank: i + 1, title: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 90), domain };
  }).filter(Boolean);
}

const ENGINES = [
  { name: 'duckduckgo', url: q => `https://duckduckgo.com/?q=${q}&ia=web&kl=us-en`, sel: 'a[data-testid="result-title-a"]' },
  { name: 'bing',       url: q => `https://www.bing.com/search?q=${q}&setlang=en-us&cc=us`, sel: '#b_results li.b_algo h2' },
  { name: 'google',     url: q => `https://www.google.com/search?q=${q}&hl=en&gl=us&num=10`, sel: '#search h3, #rso h3' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--lang=en-US,en', '--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const summary = {};
  for (const eng of ENGINES) {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 2 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    try {
      await page.goto(eng.url(encodeURIComponent(QUERY)), { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(1200);
      // Privacy-preserving: dismiss consent walls by rejecting, never accepting.
      await page.evaluate(() => {
        const b = document.querySelector('#bnp_btn_reject');
        if (b) return b.click();
        const wants = t => /reject all|reject|decline|necessary only/i.test(t);
        const hit = [...document.querySelectorAll('button,div[role="button"],a')].find(x => wants(x.innerText || x.getAttribute('aria-label') || ''));
        if (hit) hit.click();
      }).catch(() => {});
      await sleep(1000);
      await page.evaluate(async () => { for (let y = 0; y < 2500; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
      await sleep(1000);
      const data = await page.evaluate(overlay, eng.sel, 8);
      await page.evaluate(overlay, eng.sel, 8); // redraw just before the shot
      await page.screenshot({ path: path.join(OUT, `serp-${eng.name}.png`), clip: { x: 0, y: 0, width: 1100, height: 1450 } });
      summary[eng.name] = data;
      console.error(`[${eng.name}] ${data.length} results captured`);
    } catch (e) {
      summary[eng.name] = { error: e.message };
      console.error(`[${eng.name}] FAILED: ${e.message}`);
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(summary, null, 2));
})();

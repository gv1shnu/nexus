const axios = require('axios');

// Google has no free public search API, so — like the Reddit engine — we scrape
// the HTML of the results page. The modern desktop results page hard-requires
// JavaScript (a plain fetch just gets an "enable JS" shim), so instead we request
// Google's lightweight feature-phone / WAP results page, which is still served as
// plain, parseable HTML with no JS. A vintage feature-phone User-Agent is what
// triggers that variant; a desktop UA does not.
//
// This is inherently fragile: Google rotates markup, rate-limits datacenter IPs,
// and can serve a CAPTCHA ("/sorry/") or a consent interstitial. We mitigate what
// we can (feature-phone UA, pre-accepted CONSENT cookie, personalization off) and
// fail soft to [] on anything unexpected, so a bad Google fetch never takes the
// rest of Nexus down.
const SEARCH_URL = 'https://www.google.com/search';

// A vintage feature-phone UA — this is what makes Google serve the no-JS WAP page
// with real, parseable result links instead of the JavaScript-required desktop page.
const UA = 'Nokia6230/2.0 (04.44) Profile/MIDP-2.0 Configuration/CLDC-1.1';

function stripTags(s) {
    return s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x[0-9a-f]+;/gi, ' ')   // stray hex entities (icons, ›, …)
        .replace(/[�…]/g, ' ')    // replacement char + ellipsis placeholder
        .replace(/\s+/g, ' ')
        .trim();
}

// On the WAP page every organic result links through a /url?q=<DEST>&... redirect.
// Pull <DEST> back out and validate it. Returns null for anything that isn't an
// external result URL (Google-internal links use /search, /preferences, etc.).
function cleanUrl(href) {
    if (!href || !href.startsWith('/url?')) return null;
    const m = href.match(/[?&]q=([^&]*)/); // stops at & or &amp;
    if (!m) return null;
    let url = m[1].replace(/&amp;$/, '');
    try { url = decodeURIComponent(url); } catch { /* already decoded */ }
    if (!/^https?:\/\//i.test(url)) return null;
    try {
        const host = new URL(url).hostname;
        if (/(^|\.)google\.[a-z.]+$/i.test(host)) return null;
    } catch { return null; }
    return url;
}

// Parse organic results from the WAP results HTML. We deliberately key on stable
// structure — the /url?q= redirect anchors — rather than Google's obfuscated CSS
// class names (which change often). For each result anchor: the first inner <span>
// is the title, and the snippet is the longest text span in the markup that
// follows, up to the next result.
function parse(html) {
    const items = [];
    const seen = new Set();
    // Each organic hit: <a ... href="/url?q=...">...</a>. Related-search links use
    // /search?q= and so are naturally excluded by cleanUrl.
    const anchorRe = /<a\s+[^>]*?href="(\/url\?q=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const url = cleanUrl(m[1]);
        if (!url || seen.has(url)) continue;

        // Title = first <span> inside the anchor (the breadcrumb URL is a later span).
        const spanM = m[2].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
        const title = stripTags(spanM ? spanM[1] : m[2]);
        if (!title) continue;

        seen.add(url);

        // Snippet: scan the markup after this anchor, up to the next result anchor,
        // and take the longest plain-text span (skips the date chip and breadcrumb).
        const tail = html.slice(anchorRe.lastIndex, anchorRe.lastIndex + 3000);
        const content = extractSnippet(tail);

        items.push({ title, url, content, engine: 'google', publishedDate: null });
    }
    return items;
}

// Best-effort snippet from the markup following a result's title anchor.
function extractSnippet(tail) {
    const cut = tail.search(/href="\/url\?q=/i);
    const region = cut === -1 ? tail : tail.slice(0, cut);

    let best = '';
    const spanRe = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
    let s;
    while ((s = spanRe.exec(region)) !== null) {
        const text = stripTags(s[1]);
        // Skip breadcrumbs (contain the › separator, stripped to a domainy string)
        // and pick the longest remaining run of prose.
        if (text.length > best.length && !/^www\.|^[a-z0-9.-]+\.[a-z]{2,}\s/i.test(text)) {
            best = text;
        }
    }
    return best.length >= 20 ? best : '';
}

async function fetchPage(query, { num = 20, start = 0, safe = 'off' } = {}) {
    const res = await axios.get(SEARCH_URL, {
        params: {
            q: query,
            num,          // requested result count (Google treats this as a hint)
            start,        // result offset, for pagination
            hl: 'en',     // interface language
            gl: 'us',     // geolocation bias
            pws: 0,       // no personalized results
            safe          // 'off' | 'active'
        },
        headers: {
            'User-Agent': UA,
            // Pre-accept the EU cookie-consent interstitial so we get results.
            'Cookie': 'CONSENT=YES+cb.20220301-11-p0.en+FX+000',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 15000,
        validateStatus: s => s >= 200 && s < 400
    });
    return res.data;
}

// Engine entrypoint: returns Nexus's shaped { web } payload. Fails soft to an empty
// list on any error (block, CAPTCHA, timeout, markup change) so the fan-out survives.
async function search(query) {
    try {
        const html = await fetchPage(query);
        if (/\/sorry\/|unusual traffic/i.test(html)) return { web: [] }; // rate-limited
        return { web: parse(html) };
    } catch {
        return { web: [] };
    }
}

module.exports = { search, parse, cleanUrl };

// --- Standalone CLI: `node backend/engines/google.js "your query"` -----------
// Prints the parsed organic results as JSON. Handy for testing the scraper in
// isolation, outside the Nexus fan-out.
if (require.main === module) {
    const query = process.argv.slice(2).join(' ').trim();
    if (!query) {
        console.error('usage: node backend/engines/google.js "<query>"');
        process.exit(1);
    }
    search(query).then(({ web }) => {
        console.error(`\n${web.length} result(s) for "${query}":\n`);
        console.log(JSON.stringify(web, null, 2));
    });
}

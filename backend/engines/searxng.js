const axios = require('axios');
const { readFileSync } = require('fs');
const path = require('path');

// Base origin of the SearXNG instance, e.g. http://localhost:8080 (local Docker)
// or the internal address of the Render SearXNG service. When unset, the engine
// is disabled and simply contributes no results (Nexus still runs). A bare
// host:port (as Render's service linking provides) is upgraded to http://.
function resolveSearxBase() {
    let base = (process.env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = `http://${base}`;
    return base;
}
const SEARXNG_BASE = resolveSearxBase();
const SEARXNG_URL = SEARXNG_BASE ? `${SEARXNG_BASE}/search` : '';
const ENGINES_FILE = path.join(__dirname, '..', 'searxng', 'enabled.txt');

function getEngines() {
    try {
        return readFileSync(ENGINES_FILE, 'utf-8')
            .split('\n').map(e => e.trim()).filter(Boolean).join(',');
    } catch {
        return 'duckduckgo,brave,wikipedia,stackoverflow,qwant,startpage,bing';
    }
}

// One SearXNG query. `engines` is only sent for general search — image/video
// categories have their own engine set, so restricting them to the text engine
// list would return nothing.
async function fetchSearx(query, { category = 'general', page = 1, safesearch = 1 } = {}) {
    try {
        const params = {
            q: query,
            format: 'json',
            language: 'en-US',
            pageno: page,
            categories: category,
            safesearch // 0 = off, 1 = moderate, 2 = strict
        };
        if (category === 'general') params.engines = getEngines();

        const res = await axios.get(SEARXNG_URL, { params, timeout: 20000 });
        return res.data.results || [];
    } catch (e) {
        return [];
    }
}

const mapWeb = item => ({
    title: item.title,
    url: item.url,
    content: item.content || '',
    engine: `searxng-${item.engine || 'unknown'}`,
    publishedDate: item.publishedDate || null
});

// SearXNG image results carry img_src / thumbnail_src; map to Nexus image shape.
const mapImage = tag => item => ({
    title: item.title || '',
    url: item.url || item.img_src || '',
    image: item.img_src || '',
    thumbnail: item.thumbnail_src || item.img_src || '',
    source: item.engine || '',
    engine: tag
});

function dedupeByUrl(items) {
    const map = new Map();
    for (const it of items) if (it.url) map.set(it.url, it);
    return [...map.values()];
}

async function search(query) {
    // Disabled when SEARXNG_URL is not configured — return empty immediately so
    // we don't burn four 20s timeouts per query against a non-existent instance.
    if (!SEARXNG_URL) return { web: [], images: [], nsfw: [] };

    // Web (general, 2 pages via the enabled engine list) + image search. SearXNG is
    // a robust image source (Bing/Google/Flickr/Pinterest) — unlike DuckDuckGo's
    // image endpoint, which is frequently 403-blocked. NSFW = same image search with
    // safesearch off.
    const [web1, web2, imagesRaw, nsfwRaw] = await Promise.all([
        fetchSearx(query, { category: 'general', page: 1 }),
        fetchSearx(query, { category: 'general', page: 2 }),
        fetchSearx(query, { category: 'images', safesearch: 1 }),
        fetchSearx(query, { category: 'images', safesearch: 0 })
    ]);

    const web = dedupeByUrl([...web1, ...web2].map(mapWeb));
    const images = dedupeByUrl(imagesRaw.map(mapImage('searxng-images')));
    const nsfw = dedupeByUrl(nsfwRaw.map(mapImage('searxng-nsfw')));

    return { web, images, nsfw };
}

// Wake a sleeping SearXNG service (Render free tier spins services down after
// ~15 min idle, independently of the main app) so it's ready before the first
// real search. Fire-and-forget: retries through a cold start, any HTTP response
// counts as "awake". Set SEARXNG_WARM_URL to SearXNG's PUBLIC .onrender.com URL
// if pinging the internal address doesn't trigger spin-up.
async function warm({ attempts = 8, gapMs = 7000 } = {}) {
    if (!SEARXNG_BASE) return false;
    const target = (process.env.SEARXNG_WARM_URL || SEARXNG_BASE).trim().replace(/\/+$/, '');
    for (let i = 0; i < attempts; i++) {
        try {
            // /healthz is SearXNG's health endpoint; validateStatus:true means
            // even a 403/404 resolves — a response at all means it's up.
            await axios.get(`${target}/healthz`, { timeout: 8000, validateStatus: () => true });
            return true;
        } catch {
            // Connection refused / timeout => still spinning up. Wait and retry.
            if (i < attempts - 1) await new Promise(r => setTimeout(r, gapMs));
        }
    }
    return false;
}

module.exports = { search, warm };

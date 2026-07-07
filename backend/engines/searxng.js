const axios = require('axios');
const { readFileSync } = require('fs');
const path = require('path');

const SEARXNG_URL = 'http://localhost:8080/search';
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

module.exports = { search };

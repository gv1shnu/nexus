const axios = require('axios');

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const PAGE_SIZE = 100;
const MAX_PAGES = 2; // deeper pages return loosely-related noise; keep it tight

async function search(query) {
    const fetchPage = async (offset) => {
        try {
            const res = await axios.get(WIKI_API, {
                params: {
                    action: 'query',
                    list: 'search',
                    srsearch: query,
                    srlimit: PAGE_SIZE, // max per page is 50/100 depending on wiki limits
                    srprop: 'snippet|timestamp',
                    format: 'json',
                    origin: '*',
                    sroffset: offset
                },
                timeout: 10000,
                headers: {
                    'User-Agent': 'Nexus/1.0 (metasearch engine)'
                }
            });
            return res.data.query?.search || [];
        } catch (e) {
            return [];
        }
    };

    // Fetch fixed offsets in parallel instead of chasing continuation tokens serially.
    const offsets = Array.from({ length: MAX_PAGES }, (_, i) => i * PAGE_SIZE);
    const pages = await Promise.all(offsets.map(fetchPage));
    const allItems = pages.flat();

    const results = allItems.map(item => ({
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        content: item.snippet.replace(/<[^>]*>/g, ''),
        engine: 'wikipedia',
        // NOTE: the search API's `timestamp` is the article's LAST-EDIT time, not a
        // publish date. Using it made constantly-edited encyclopedia pages look
        // "freshly published" and dominate the date sort, so we omit it — Wikipedia
        // articles are timeless references and rank by relevance instead.
        publishedDate: null
    }));

    // Wikipedia is an encyclopedia/reference source, distinct from research
    // papers (arXiv), so it gets its own category rather than "academic".
    return { reference: results };
}

module.exports = { search };

const axios = require('axios');

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

async function search(query) {
    let allItems = [];
    let offset = 0;
    let keepGoing = true;
    let loops = 0;

    while (keepGoing && loops < 5) {
        try {
            const res = await axios.get(WIKI_API, {
                params: {
                    action: 'query',
                    list: 'search',
                    srsearch: query,
                    srlimit: 100, // max per page is 50/100 depending on wiki limits
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

            const items = res.data.query?.search || [];
            if (items.length === 0) {
                keepGoing = false;
            } else {
                allItems.push(...items);
                if (res.data.continue?.sroffset) {
                    offset = res.data.continue.sroffset;
                    loops++;
                } else {
                    keepGoing = false;
                }
            }
        } catch (e) {
            keepGoing = false;
        }
    }

    const results = allItems.map(item => ({
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        content: item.snippet.replace(/<[^>]*>/g, ''),
        engine: 'wikipedia',
        publishedDate: item.timestamp || null
    }));

    return { academic: results };
}

module.exports = { search };

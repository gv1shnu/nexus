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

async function search(query) {
    const fetchPage = async (page) => {
        try {
            const res = await axios.get(SEARXNG_URL, {
                params: {
                    q: query,
                    format: 'json',
                    language: 'en-US',
                    engines: getEngines(),
                    pageno: page
                },
                timeout: 20000
            });
            return res.data.results || [];
        } catch (e) {
            return [];
        }
    };

    const pages = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
    const allResults = pages.flat();

    const results = allResults.map(item => ({
        title: item.title,
        url: item.url,
        content: item.content || '',
        engine: `searxng-${item.engine || 'unknown'}`,
        publishedDate: item.publishedDate || null
    }));

    // Deduplicate exact URL matches from SearXNG's multi-page query
    const uniqueMap = new Map();
    results.forEach(r => uniqueMap.set(r.url, r));

    return { web: Array.from(uniqueMap.values()) };
}

module.exports = { search };

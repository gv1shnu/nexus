const axios = require('axios');

const ARXIV_API = 'http://export.arxiv.org/api/query';

function parseXML(xml) {
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim().replace(/\s+/g, ' ') || '';
        const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim().replace(/\s+/g, ' ') || '';
        const id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim() || '';
        const published = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1]?.trim() || null;

        // Extract authors
        const authors = [];
        const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>/g;
        let authorMatch;
        while ((authorMatch = authorRegex.exec(entry)) !== null) {
            authors.push(authorMatch[1].trim());
        }

        // Extract PDF link
        const pdfLink = (entry.match(/href="([^"]*?)"[^>]*title="pdf"/) || [])[1] || '';

        entries.push({
            title,
            url: id,
            content: summary.substring(0, 300),
            engine: 'arxiv',
            authors: authors.slice(0, 5),
            pdfUrl: pdfLink,
            publishedDate: published
        });
    }

    return entries;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 2; // deeper pages return loosely-related noise; keep it tight

async function search(query) {
    const fetchPage = async (start) => {
        try {
            const res = await axios.get(ARXIV_API, {
                params: {
                    search_query: `all:${query}`,
                    start: start,
                    max_results: PAGE_SIZE,
                    sortBy: 'relevance',
                    sortOrder: 'descending'
                },
                timeout: 15000
            });
            return parseXML(res.data);
        } catch (e) {
            return [];
        }
    };

    // Fetch fixed offsets in parallel rather than paging serially.
    const starts = Array.from({ length: MAX_PAGES }, (_, i) => i * PAGE_SIZE);
    const pages = await Promise.all(starts.map(fetchPage));
    const allEntries = pages.flat();

    return { academic: allEntries };
}

module.exports = { search };

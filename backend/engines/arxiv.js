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

async function search(query) {
    let allEntries = [];
    let start = 0;
    let keepGoing = true;
    let loops = 0;

    while (keepGoing && loops < 5) {
        try {
            const res = await axios.get(ARXIV_API, {
                params: {
                    search_query: `all:${query}`,
                    start: start,
                    max_results: 100,
                    sortBy: 'relevance',
                    sortOrder: 'descending'
                },
                timeout: 15000
            });

            const parsed = parseXML(res.data);
            if (parsed.length === 0) {
                keepGoing = false;
            } else {
                allEntries.push(...parsed);
                start += 100;
                loops++;
            }
        } catch (e) {
            keepGoing = false;
        }
    }

    return { academic: allEntries };
}

module.exports = { search };

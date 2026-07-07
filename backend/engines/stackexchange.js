const axios = require('axios');

const SE_API = 'https://api.stackexchange.com/2.3/search/excerpts';

const PAGE_SIZE = 100;
const MAX_PAGES = 2; // deeper pages return loosely-related noise; keep it tight

async function search(query) {
    const fetchPage = async (page) => {
        try {
            const res = await axios.get(SE_API, {
                params: {
                    q: query,
                    site: 'stackoverflow',
                    pagesize: PAGE_SIZE,
                    page: page,
                    order: 'desc',
                    sort: 'relevance'
                },
                timeout: 15000
            });
            return res.data.items || [];
        } catch (e) {
            return [];
        }
    };

    // Fetch pages in parallel; the API's 1-based paging is independent per page.
    const pageNums = Array.from({ length: MAX_PAGES }, (_, i) => i + 1);
    const pages = await Promise.all(pageNums.map(fetchPage));
    const allItems = pages.flat();

    const results = allItems.map(item => ({
        title: item.title,
        url: `https://stackoverflow.com/q/${item.question_id}`,
        content: (item.excerpt || '').replace(/<[^>]*>/g, ''),
        engine: 'stackoverflow',
        score: item.question_score || 0,
        answerCount: item.answer_count || 0,
        tags: item.tags || [],
        publishedDate: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : null
    }));

    return { code: results };
}

module.exports = { search };

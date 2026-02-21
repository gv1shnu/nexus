const axios = require('axios');

const SE_API = 'https://api.stackexchange.com/2.3/search/excerpts';

async function search(query) {
    let allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
        try {
            const res = await axios.get(SE_API, {
                params: {
                    q: query,
                    site: 'stackoverflow',
                    pagesize: 100,
                    page: page,
                    order: 'desc',
                    sort: 'relevance'
                },
                timeout: 15000
            });

            const items = res.data.items || [];
            if (items.length === 0) {
                hasMore = false;
            } else {
                allItems.push(...items);
                hasMore = res.data.has_more;
                page++;
            }
        } catch (e) {
            hasMore = false;
        }
    }

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

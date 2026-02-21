const axios = require('axios');

const REDDIT_API = 'https://www.reddit.com/search.json';

async function search(query) {
    let allItems = [];
    let afterToken = null;
    let keepGoing = true;
    let loops = 0;

    while (keepGoing && loops < 4) {
        try {
            const res = await axios.get(REDDIT_API, {
                params: {
                    q: query,
                    sort: 'relevance',
                    limit: 100,
                    t: 'all',
                    after: afterToken
                },
                headers: {
                    'User-Agent': 'Nexus/1.0'
                },
                timeout: 10000
            });

            const children = res.data.data?.children || [];
            if (children.length === 0) {
                keepGoing = false;
            } else {
                allItems.push(...children);
                afterToken = res.data.data?.after;
                if (!afterToken) {
                    keepGoing = false;
                }
                loops++;
            }
        } catch (e) {
            keepGoing = false;
        }
    }

    const results = allItems.map(item => {
        const d = item.data;
        return {
            title: d.title,
            url: `https://www.reddit.com${d.permalink}`,
            content: d.selftext?.substring(0, 300) || '',
            engine: 'reddit',
            subreddit: d.subreddit_name_prefixed || '',
            upvotes: d.ups || 0,
            commentCount: d.num_comments || 0,
            publishedDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null
        };
    });

    return { community: results };
}

module.exports = { search };

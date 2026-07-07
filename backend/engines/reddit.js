const axios = require('axios');

// Reddit's unauthenticated JSON API is now heavily rate-limited/blocked, so we
// scrape the old.reddit.com search page HTML instead. Safesearch is OFF here:
// the `over18=1` cookie + `include_over_18=on` let NSFW posts through. Safe posts
// go to the community tab; NSFW posts that have a real image thumbnail are routed
// to the (image-grid) nsfw tab.
const SEARCH_URL = 'https://old.reddit.com/search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decode(s) {
    return s
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

function parse(html) {
    const items = [];
    // Split into one chunk per search result so each post's thumbnail (which sits
    // BEFORE its title in the markup) stays with the right result.
    const blocks = html.split(/<div class="\s*search-result search-result-link/).slice(1);

    for (const block of blocks) {
        const titleM = block.match(/<a\b([^>]*\bsearch-title\b[^>]*)>([\s\S]*?)<\/a>/);
        if (!titleM) continue;
        const href = (titleM[1].match(/href="([^"]+)"/) || [])[1];
        const title = decode(titleM[2]);
        if (!href || !title) continue;

        // old.reddit strips the <img> from NSFW post thumbnails in server HTML, so
        // we can't get preview images for them — NSFW posts are surfaced as link cards.
        const isNsfw = /nsfw-stamp|thumbnail nsfw/i.test(block);

        const score = (block.match(/class="search-score"[^>]*>([^<]*)</) || [])[1] || '';
        const comments = (block.match(/class="search-comments[^"]*"[^>]*>([^<]*)</) || [])[1] || '';
        const sub = (block.match(/class="search-subreddit-link[^"]*"[^>]*>([^<]*)</) || [])[1] || '';
        const time = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;

        items.push({
            title,
            url: href.startsWith('http') ? href : `https://www.reddit.com${href}`,
            subreddit: sub || '',
            upvotes: parseInt(score, 10) || 0,
            commentCount: parseInt(comments, 10) || 0,
            publishedDate: time || null,
            isNsfw
        });
    }
    return items;
}

async function search(query) {
    let html = '';
    try {
        const res = await axios.get(SEARCH_URL, {
            params: { q: query, sort: 'relevance', t: 'all', limit: 50, include_over_18: 'on' },
            headers: { 'User-Agent': UA, 'Cookie': 'over18=1', 'Accept': 'text/html' },
            timeout: 12000
        });
        html = res.data;
    } catch (e) {
        return { community: [], nsfw: [] };
    }

    const community = [];
    const nsfw = [];

    for (const item of parse(html)) {
        const card = {
            title: item.title,
            url: item.url,
            content: '',
            engine: item.isNsfw ? 'reddit-nsfw' : 'reddit',
            subreddit: item.subreddit,
            upvotes: item.upvotes,
            commentCount: item.commentCount,
            publishedDate: item.publishedDate
        };
        // Safesearch-off NSFW posts go to the NSFW tab (as link cards); the rest
        // are normal community discussion.
        (item.isNsfw ? nsfw : community).push(card);
    }

    return { community, nsfw };
}

module.exports = { search };

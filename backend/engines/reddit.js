const axios = require('axios');

// Reddit engine — multi-strategy, because scraping Reddit got much harder in 2026.
//
// What changed: Reddit turned off unauthenticated `.json` access (HTTP 403) in
// May 2026, and the old.reddit HTML search rate-limits hard ("whoa there,
// pardner"). Surveying the surviving GitHub scrapers (YARS, ScrapiReddit, PRAW,
// scrapfly's 2026 write-up), the only methods that still return data are:
//   1. OAuth API           — reliable, but needs a (free) app credential
//   2. search.rss + a *descriptive* User-Agent — free, no key, but rate-limited
//                            (a browser-like UA gets 429; a named one gets 200)
//   3. old.reddit HTML     — heavily rate-limited, last resort
//
// So we try them in order of reliability and return the first that yields posts,
// failing soft to empty (like every other engine) so the fan-out survives.
//
// Safe posts go to the Community tab; over-18 posts (only detectable via OAuth /
// the HTML nsfw-stamp) go to the "other" tab.

// Reddit asks for a unique, descriptive User-Agent. A generic/browser UA is what
// trips the aggressive rate limiter on the RSS endpoint.
const UA = 'nexus-metasearch/1.0 (+https://github.com/gv1shnu/nexus)';
const RSS_URL = 'https://www.reddit.com/search.rss';
const OLD_URL = 'https://old.reddit.com/search';
const OAUTH_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const OAUTH_API = 'https://oauth.reddit.com/search';

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

const permalinkToUrl = p => (p && p.startsWith('http')) ? p : `https://www.reddit.com${p || ''}`;
const subFromUrl = url => (String(url).match(/\/r\/([^/]+)\//) || [])[1] || '';

// --- Strategy 1: OAuth API (only when app credentials are configured) ---------
// Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (a "script" app at
// reddit.com/prefs/apps) to use the authenticated API — the one method Reddit
// doesn't rate-limit into uselessness. App-only (client_credentials) is enough
// for public search; no user login required.
let cachedToken = null; // { token, expiresAt }

async function getToken() {
    const id = process.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET;
    if (!id || !secret) return null;
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

    const res = await axios.post(OAUTH_TOKEN_URL, 'grant_type=client_credentials', {
        auth: { username: id, password: secret },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
    });
    cachedToken = {
        token: res.data.access_token,
        expiresAt: Date.now() + (res.data.expires_in - 60) * 1000, // refresh a minute early
    };
    return cachedToken.token;
}

async function searchOAuth(query) {
    const token = await getToken();
    if (!token) return null; // not configured → let the next strategy try
    const res = await axios.get(OAUTH_API, {
        params: { q: query, sort: 'relevance', t: 'all', limit: 50, include_over_18: 'on', raw_json: 1 },
        headers: { 'User-Agent': UA, Authorization: `Bearer ${token}` },
        timeout: 12000,
    });
    return (res.data?.data?.children || []).map(({ data: d }) => ({
        title: d.title,
        url: permalinkToUrl(d.permalink),
        content: (d.selftext || '').slice(0, 300),
        subreddit: d.subreddit ? `r/${d.subreddit}` : '',
        upvotes: d.ups || 0,
        commentCount: d.num_comments || 0,
        publishedDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        isOther: !!d.over_18,
    }));
}

// --- Strategy 2: Atom RSS (free, no key) --------------------------------------
// search.rss returns real posts with real timestamps. It has no scores and no
// over-18 flag, so those come back 0 / community-only. Rate-limited: a 429 just
// returns null so the next strategy runs.
async function searchRSS(query) {
    const res = await axios.get(RSS_URL, {
        params: { q: query, sort: 'relevance', limit: 50 },
        headers: { 'User-Agent': UA, Accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeout: 12000,
        responseType: 'text',
        transformResponse: r => r,
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return null; // 429/block → fall through

    const items = [];
    for (const chunk of res.data.split('<entry>').slice(1)) {
        const entry = chunk.slice(0, chunk.indexOf('</entry>'));
        const grab = re => (entry.match(re) || [])[1] || '';
        const url = grab(/<link href="([^"]+)"/);
        if (!/\/comments\//.test(url)) continue; // skip "did you mean" subreddit suggestions
        const title = decode(grab(/<title>([\s\S]*?)<\/title>/));
        if (!title) continue;
        const updated = grab(/<updated>([^<]+)<\/updated>/) || null;
        items.push({
            title,
            url,
            content: '',
            subreddit: subFromUrl(url) ? `r/${subFromUrl(url)}` : '',
            upvotes: 0,           // not exposed by RSS
            commentCount: 0,      // not exposed by RSS
            publishedDate: updated,
            isOther: false,       // RSS can't flag over-18
        });
    }
    return items.length ? items : null;
}

// --- Strategy 3: old.reddit HTML scrape (last resort) -------------------------
function parseHtml(html) {
    const items = [];
    const blocks = html.split(/<div class="\s*search-result search-result-link/).slice(1);
    for (const block of blocks) {
        const titleM = block.match(/<a\b([^>]*\bsearch-title\b[^>]*)>([\s\S]*?)<\/a>/);
        if (!titleM) continue;
        const href = (titleM[1].match(/href="([^"]+)"/) || [])[1];
        const title = decode(titleM[2]);
        if (!href || !title) continue;
        const isOther = /nsfw-stamp|thumbnail nsfw/i.test(block);
        const score = (block.match(/class="search-score"[^>]*>([^<]*)</) || [])[1] || '';
        const comments = (block.match(/class="search-comments[^"]*"[^>]*>([^<]*)</) || [])[1] || '';
        const sub = (block.match(/class="search-subreddit-link[^"]*"[^>]*>([^<]*)</) || [])[1] || '';
        const time = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
        items.push({
            title,
            url: href.startsWith('http') ? href : `https://www.reddit.com${href}`,
            content: '',
            subreddit: sub || '',
            upvotes: parseInt(score, 10) || 0,
            commentCount: parseInt(comments, 10) || 0,
            publishedDate: time || null,
            isOther,
        });
    }
    return items;
}

async function searchOldReddit(query) {
    const res = await axios.get(OLD_URL, {
        params: { q: query, sort: 'relevance', t: 'all', limit: 50, include_over_18: 'on' },
        headers: { 'User-Agent': UA, Cookie: 'over18=1', Accept: 'text/html' },
        timeout: 12000,
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return null;
    const items = parseHtml(res.data);
    return items.length ? items : null;
}

// Try each strategy in reliability order; first one to return posts wins.
async function search(query) {
    let posts = null;
    for (const strategy of [searchOAuth, searchRSS, searchOldReddit]) {
        try {
            posts = await strategy(query);
            if (posts && posts.length) break;
        } catch { /* strategy failed → try the next */ }
    }
    if (!posts) return { community: [], other: [] };

    const community = [];
    const other = [];
    for (const p of posts) {
        const { isOther, ...card } = p;
        card.engine = isOther ? 'reddit-other' : 'reddit';
        (isOther ? other : community).push(card);
    }
    return { community, other };
}

module.exports = { search };

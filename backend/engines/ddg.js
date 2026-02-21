const { execFile } = require('child_process');
const axios = require('axios');
const path = require('path');

const DDG_INSTANT_URL = 'https://api.duckduckgo.com/';
const DDGS_SCRIPT = path.join(__dirname, 'ddg_search.py');
const MAX_RESULTS = 30;

// Source 1: DuckDuckGo Instant Answer API (structured knowledge)
async function instantAnswers(query) {
    const res = await axios.get(DDG_INSTANT_URL, {
        params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
        timeout: 10000
    });

    const data = res.data;
    const results = [];

    if (data.AbstractText && data.AbstractURL) {
        results.push({
            title: data.Heading || query,
            url: data.AbstractURL,
            content: data.AbstractText,
            engine: 'duckduckgo-instant',
            publishedDate: null
        });
    }

    if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics) {
            if (topic.FirstURL && topic.Text) {
                results.push({
                    title: topic.Text.substring(0, 120),
                    url: topic.FirstURL,
                    content: topic.Text,
                    engine: 'duckduckgo-instant',
                    publishedDate: null
                });
            }
            if (topic.Topics) {
                for (const sub of topic.Topics) {
                    if (sub.FirstURL && sub.Text) {
                        results.push({
                            title: sub.Text.substring(0, 120),
                            url: sub.FirstURL,
                            content: sub.Text,
                            engine: 'duckduckgo-instant',
                            publishedDate: null
                        });
                    }
                }
            }
        }
    }

    return { web: results };
}

// Source 2: ddgs Python library (text, images, videos, news, documents)
function ddgsSearch(query) {
    return new Promise((resolve, reject) => {
        execFile('python', [DDGS_SCRIPT, query, String(MAX_RESULTS)], {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024
        }, (err, stdout, stderr) => {
            if (err) {
                console.error('ddgs stderr:', stderr);
                return reject(new Error(`ddgs failed: ${err.message}`));
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (parseErr) {
                reject(new Error(`ddgs JSON parse failed: ${parseErr.message}`));
            }
        });
    });
}

// Merge both sources
async function search(query) {
    const [instant, ddgs] = await Promise.allSettled([
        instantAnswers(query),
        ddgsSearch(query)
    ]);

    const result = {
        web: [],
        images: [],
        videos: [],
        news: [],
        documents: [],
        books: []
    };

    if (instant.status === 'fulfilled') {
        result.web.push(...(instant.value.web || []));
    }

    if (ddgs.status === 'fulfilled') {
        const d = ddgs.value;
        result.web.push(...(d.web || []));
        result.images.push(...(d.images || []));
        result.videos.push(...(d.videos || []));
        result.news.push(...(d.news || []));
        result.documents.push(...(d.documents || []));
        result.books.push(...(d.books || []));
    }

    return result;
}

module.exports = { search };

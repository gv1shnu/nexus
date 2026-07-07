const { rankResults, filterRelevant } = require('./util/ranking');
const { BM25, tokenize } = require('./util/bm25');

describe('filterRelevant', () => {
    const results = [
        { title: 'Python asyncio guide', url: 'https://a.com', content: 'await coroutines' },
        { title: 'Cooking pasta', url: 'https://b.com', content: 'boil water add salt' },
        { title: 'random', url: 'https://c.com', content: 'mentions python somewhere' }
    ];

    test('drops results with no query term in title or content', () => {
        const kept = filterRelevant(results, 'python');
        expect(kept.map(r => r.url)).toEqual(['https://a.com', 'https://c.com']);
    });

    test('keeps partial matches for multi-word queries', () => {
        const kept = filterRelevant(results, 'python async');
        // b.com has neither term → dropped; a.com and c.com each have "python".
        expect(kept.map(r => r.url)).toEqual(['https://a.com', 'https://c.com']);
    });

    test('empty query keeps everything', () => {
        expect(filterRelevant(results, '   ')).toHaveLength(3);
    });
});

describe('BM25', () => {
    test('scores a matching document above a non-matching one', () => {
        const docs = [
            'asynchronous python programming with asyncio',
            'how to cook pasta with tomato sauce'
        ].map(tokenize);
        const bm25 = new BM25(docs);
        const q = tokenize('python asyncio');
        expect(bm25.score(q, 0)).toBeGreaterThan(bm25.score(q, 1));
    });

    test('gives zero to a document with no query terms', () => {
        const docs = ['cooking recipes and food'].map(tokenize);
        const bm25 = new BM25(docs);
        expect(bm25.score(tokenize('quantum physics'), 0)).toBe(0);
    });
});

describe('rankResults (BM25 + RRF)', () => {
    test('deduplicates by URL and sums RRF across engines', () => {
        const results = [
            { title: 'consensus', url: 'https://x.com', content: 'a', engine: 'wikipedia' },
            { title: 'consensus', url: 'https://x.com', content: 'a', engine: 'stackoverflow' },
            { title: 'consensus', url: 'https://x.com', content: 'a', engine: 'reddit' },
            { title: 'lonely', url: 'https://y.com', content: 'b', engine: 'duckduckgo' }
        ];
        const ranked = rankResults(results, 'nomatch', 'relevance');
        // Three duplicate URLs collapse to one entry.
        expect(ranked.filter(r => r.url === 'https://x.com')).toHaveLength(1);
        // The multi-engine URL outranks the single-engine one on RRF alone.
        expect(ranked[0].url).toBe('https://x.com');
    });

    test('strong text match competes with cross-engine consensus', () => {
        const results = [
            { title: 'machine learning tutorial', url: 'https://ml.com', content: 'deep learning models', engine: 'duckduckgo' },
            { title: 'random page', url: 'https://r.com', content: 'unrelated text', engine: 'duckduckgo' }
        ];
        const ranked = rankResults(results, 'machine learning', 'relevance');
        expect(ranked[0].url).toBe('https://ml.com');
    });

    test('date sort orders newest first, undated items last', () => {
        const results = [
            { title: 'old', url: 'https://old.com', content: '', engine: 'duckduckgo', publishedDate: '2000-01-01' },
            { title: 'new', url: 'https://new.com', content: '', engine: 'duckduckgo', publishedDate: '2024-01-01' },
            { title: 'undated', url: 'https://undated.com', content: '', engine: 'duckduckgo', publishedDate: null }
        ];
        const ranked = rankResults(results, 'anything', 'date');
        expect(ranked.map(r => r.url)).toEqual([
            'https://new.com',
            'https://old.com',
            'https://undated.com'
        ]);
    });

    test('skips items without a URL', () => {
        const results = [
            { title: 'no url', content: 'x', engine: 'duckduckgo' },
            { title: 'has url', url: 'https://ok.com', content: 'x', engine: 'duckduckgo' }
        ];
        const ranked = rankResults(results, 'x', 'relevance');
        expect(ranked).toHaveLength(1);
        expect(ranked[0].url).toBe('https://ok.com');
    });
});

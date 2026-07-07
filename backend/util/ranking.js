// Result ranking for the metasearch: blends two complementary relevance signals
// plus light priors.
//
//   BM25  — "does this document's text match the query?" (term frequency,
//           IDF, length normalization). See util/bm25.
//   RRF   — Reciprocal Rank Fusion: "did multiple independent engines rank this
//           highly?" The canonical way to merge ranked lists in metasearch.
//           A URL returned near the top by several engines wins.
//
// Both signals are normalized to [0,1] and averaged so neither dominates by
// scale, then small priors (source trust, recency) nudge ties.
const { BM25, tokenize } = require('./bm25');

const TRUSTED_DOMAINS = [
    'wikipedia.org',
    'stackoverflow.com',
    'github.com',
    'medium.com',
    'arxiv.org',
    'reddit.com'
];

const ENGINE_WEIGHTS = {
    'wikipedia': 50,
    'stackoverflow': 40,
    'duckduckgo': 25,
    'duckduckgo-instant': 30,
    'duckduckgo-news': 20,
    'duckduckgo-videos': 15,
    'duckduckgo-images': 10,
    'duckduckgo-dorks': 20,
    'arxiv': 35,
    'reddit': 15,
    'cwe-mitre': 30
};

// RRF dampening constant. 60 is the value from the original Cormack et al. paper.
const RRF_K = 60;

// Min-max normalize to [0,1]; returns all-zeros when there's no spread so a
// flat signal contributes nothing to the blend.
function normalize(values) {
    if (values.length === 0) return values;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const range = max - min;
    if (range === 0) return values.map(() => 0);
    return values.map(v => (v - min) / range);
}

// Drop results that contain NONE of the query terms in their title or content.
// This is the guard against "I searched X but got unrelated things back": if not
// a single query word appears, the item is genuinely off-topic. Multi-word
// queries keep partial matches (at least one term present) to avoid over-pruning.
function filterRelevant(results, query) {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return results;
    return results.filter(item => {
        if (!item) return false;
        const haystack = new Set(tokenize(`${item.title || ''} ${item.content || ''}`));
        return queryTerms.some(term => haystack.has(term));
    });
}

function rankResults(results, query, sortBy = 'date') {
    const now = Date.now();

    // 1. Reciprocal Rank Fusion, computed over the RAW list so a URL surfaced by
    //    several engines accumulates a contribution from each. Rank is the item's
    //    1-based position within its own engine's results (arrival order).
    const engineCounter = new Map();
    const rrfByUrl = new Map();
    for (const item of results) {
        if (!item || !item.url) continue;
        const engine = item.engine || 'unknown';
        const rank = (engineCounter.get(engine) || 0) + 1;
        engineCounter.set(engine, rank);
        const contribution = 1 / (RRF_K + rank);
        rrfByUrl.set(item.url, (rrfByUrl.get(item.url) || 0) + contribution);
    }

    // 2. Deduplicate by URL (keep first occurrence) so BM25 corpus statistics
    //    aren't skewed by duplicates.
    const seen = new Set();
    const unique = results.filter(item => {
        if (!item || !item.url) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });

    // 3. BM25 text relevance over title + content.
    const corpus = unique.map(item => tokenize(`${item.title || ''} ${item.content || ''}`));
    const bm25 = new BM25(corpus);
    const queryTerms = tokenize(query);

    const bm25Norm = normalize(unique.map((_, i) => bm25.score(queryTerms, i)));
    const rrfNorm = normalize(unique.map(item => rrfByUrl.get(item.url) || 0));

    const scored = unique.map((item, i) => {
        let domain = 'unknown';
        try {
            domain = new URL(item.url).hostname;
        } catch { }

        // Blended relevance in [0,1]: half text match, half cross-engine agreement.
        let score = 0.5 * bm25Norm[i] + 0.5 * rrfNorm[i];

        // Light priors (≈0.3 max combined) — nudge ties without overriding relevance.
        const baseEngine = item.engine?.split('-')[0] || '';
        score += ((ENGINE_WEIGHTS[item.engine] || ENGINE_WEIGHTS[baseEngine] || 5) / 50) * 0.1;
        if (TRUSTED_DOMAINS.some(d => domain.includes(d))) score += 0.1;
        if (domain.includes('stackoverflow.com')) score += 0.05;
        if (domain.includes('github.com')) score += 0.05;

        // Recency nudge.
        let publishedDate = null;
        if (item.publishedDate) {
            const parsed = new Date(item.publishedDate);
            if (!isNaN(parsed.getTime())) {
                publishedDate = parsed.toISOString();
                const ageDays = (now - parsed.getTime()) / (1000 * 60 * 60 * 24);
                if (ageDays <= 7) score += 0.15;
                else if (ageDays <= 30) score += 0.08;
                else if (ageDays <= 365) score += 0.03;
            }
        }

        return { ...item, domain, score, publishedDate };
    });

    if (sortBy === 'date') {
        scored.sort((a, b) => {
            if (a.publishedDate && b.publishedDate) return new Date(b.publishedDate) - new Date(a.publishedDate);
            if (a.publishedDate) return -1;
            if (b.publishedDate) return 1;
            return b.score - a.score; // undated items fall back to blended relevance
        });
    } else {
        scored.sort((a, b) => b.score - a.score);
    }

    return scored;
}

module.exports = { rankResults, filterRelevant, ENGINE_WEIGHTS, TRUSTED_DOMAINS, RRF_K, normalize };

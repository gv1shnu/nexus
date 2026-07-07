// BM25 relevance ranking (Okapi BM25).
//
// Replaces the old `title.includes(query)` substring check with real
// information-retrieval scoring: term frequency saturation (k1), document-length
// normalization (b), and inverse document frequency. Word order doesn't matter,
// body text counts, and common words are down-weighted automatically by IDF — so
// no stopword list is needed.

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ') // strip any leftover HTML tags
        .match(/[a-z0-9]+/g) || [];
}

class BM25 {
    constructor(docTokens, { k1 = 1.5, b = 0.75 } = {}) {
        this.k1 = k1;
        this.b = b;
        this.N = docTokens.length;
        this.docLen = docTokens.map(t => t.length);
        const totalLen = this.docLen.reduce((a, c) => a + c, 0);
        this.avgdl = this.N ? totalLen / this.N : 0;

        // Per-document term frequencies + global document frequencies.
        this.df = new Map();
        this.tf = docTokens.map(tokens => {
            const freq = new Map();
            for (const term of tokens) freq.set(term, (freq.get(term) || 0) + 1);
            for (const term of freq.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
            return freq;
        });
    }

    idf(term) {
        const n = this.df.get(term) || 0;
        // BM25 IDF with +0.5 smoothing; always positive.
        return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
    }

    score(queryTerms, docIndex) {
        const freq = this.tf[docIndex];
        const dl = this.docLen[docIndex];
        let score = 0;
        for (const term of queryTerms) {
            const f = freq.get(term) || 0;
            if (f === 0) continue;
            const idf = this.idf(term);
            const numerator = f * (this.k1 + 1);
            const denominator = f + this.k1 * (1 - this.b + this.b * (dl / (this.avgdl || 1)));
            score += idf * (numerator / denominator);
        }
        return score;
    }
}

module.exports = { BM25, tokenize };

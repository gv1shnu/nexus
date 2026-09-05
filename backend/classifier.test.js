const { classifyQuery, ENGINE_REGISTRY, GENERAL_ENGINES } = require('./util/classifier');

describe('classifyQuery — intent → engine routing', () => {
    test('code query routes to StackOverflow first', () => {
        const r = classifyQuery('how to fix TypeError in react useEffect');
        expect(r.primary).toBe('code');
        expect(r.engines[0]).toBe('stackexchange');
        expect(r.runnable).toContain('stackexchange');
    });

    test('research query routes to arXiv first', () => {
        const r = classifyQuery('attention is all you need transformer paper');
        expect(r.primary).toBe('academic');
        expect(r.engines[0]).toBe('arxiv');
    });

    test('an arXiv id is picked up by pattern', () => {
        const r = classifyQuery('quantum entanglement arxiv 2401.01234');
        expect(r.primary).toBe('academic');
    });

    test('social query routes to Reddit first', () => {
        const r = classifyQuery('best mechanical keyboard reddit');
        expect(r.primary).toBe('social');
        expect(r.engines[0]).toBe('reddit');
    });

    test('news query routes to the news engines', () => {
        const r = classifyQuery('latest news on openai');
        expect(r.primary).toBe('news');
        expect(r.engines).toEqual(expect.arrayContaining(['ddg', 'google']));
    });

    test('encyclopedic question routes to Wikipedia first', () => {
        const r = classifyQuery('who is alan turing');
        expect(r.primary).toBe('reference');
        expect(r.engines[0]).toBe('wikipedia');
    });

    test('a domain is treated as an OSINT entity', () => {
        const r = classifyQuery('github.com');
        expect(r.primary).toBe('entity');
        expect(r.engines[0]).toBe('osint');
        expect(r.runnable[0]).toBe('osint');
    });

    test('an IP is treated as an OSINT entity', () => {
        expect(classifyQuery('8.8.8.8').primary).toBe('entity');
    });

    test('a plain single word is NOT force-routed to OSINT', () => {
        // "mercury" is a bare dictionary word: entity signal is too weak to select,
        // so it falls through to a general search.
        const r = classifyQuery('mercury');
        expect(r.primary).toBe('general');
        expect(r.runnable).not.toContain('osint');
    });

    test('an unmatched query falls back to the general engines', () => {
        const r = classifyQuery('pizza recipe');
        expect(r.primary).toBe('general');
        expect(r.engines).toEqual(GENERAL_ENGINES);
    });

    test('engines are never empty and always end with a general fallback', () => {
        for (const q of ['', '   ', 'asdftqwzx', 'code error', 'reddit']) {
            const r = classifyQuery(q);
            expect(r.engines.length).toBeGreaterThan(0);
            expect(r.engines).toEqual(expect.arrayContaining(['google']));
        }
    });

    test('runnable excludes engines Nexus does not implement yet', () => {
        const r = classifyQuery('how to reverse a linked list'); // recommends github (unimplemented)
        expect(r.engines).toContain('github');
        expect(r.runnable).not.toContain('github');
        for (const e of r.runnable) expect(ENGINE_REGISTRY[e].implemented).toBe(true);
    });

    test('classification is deterministic', () => {
        const q = 'python asyncio await deadlock';
        expect(JSON.stringify(classifyQuery(q))).toBe(JSON.stringify(classifyQuery(q)));
    });

    test('mixed-intent query keeps the stronger category primary', () => {
        const r = classifyQuery('is rust worth it vs go');
        expect(r.primary).toBe('social');
        expect(r.categories.map(c => c.name)).toContain('code');
    });
});

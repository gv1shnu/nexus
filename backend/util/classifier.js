// Deterministic query → engine router.
//
// Nexus fans out to every engine by default ("go wide"). This classifier lets a
// caller ask the complementary question first: given THIS query, which engines
// actually suit it? It's a rule-based intent classifier — no ML, no network, no
// randomness, no clock — so the same string always yields the same routing, which
// makes it testable and cheap to run on every request.
//
// How it works: each intent CATEGORY carries three kinds of signal — single-word
// `terms` (matched against the query's tokens), multi-word `phrases` (substring
// match on the raw query), and `patterns` (regex over the raw query, for things
// tokenization throws away: foo(), =>, r/sub, .py, arXiv ids). Each category sums
// its matches into a score; categories above a threshold are "selected", ordered
// by score, and their engines are unioned (best-first) with a general fallback so
// the result is never empty.
const { tokenize } = require('./bm25');

// Which engines Nexus actually ships. `implemented:false` engines (github, x,
// bing) are legitimate routing *targets* the classifier can recommend, but they
// aren't wired into the fan-out yet — `runnableEngines()` filters them out so a
// caller can route real traffic without hitting a missing module.
const ENGINE_REGISTRY = {
    google:        { implemented: true },
    searxng:       { implemented: true },
    ddg:           { implemented: true },
    wikipedia:     { implemented: true },
    stackexchange: { implemented: true },
    arxiv:         { implemented: true },
    reddit:        { implemented: true },
    osint:         { implemented: true },
    github:        { implemented: false }, // planned — code/repos
    x:             { implemented: false }, // planned — X/Twitter social
    bing:          { implemented: false }, // used for SERP comparison, not a live engine
};

// Broad engines that fit almost any query; always appended so routing never
// returns an empty set and general web coverage is preserved.
const GENERAL_ENGINES = ['google', 'searxng', 'ddg', 'wikipedia'];

const WEIGHTS = { term: 2, phrase: 3, pattern: 3 };
// A category needs at least one strong signal (a pattern/phrase, or two terms)
// to be selected. Below this, its score is treated as noise.
const SELECT_THRESHOLD = 3;

// Declaration order doubles as the tie-break priority for equal scores.
const CATEGORIES = {
    code: {
        engines: ['stackexchange', 'github', 'google', 'ddg'],
        terms: new Set([
            'error', 'errors', 'exception', 'exceptions', 'traceback', 'stacktrace', 'bug', 'debug',
            'compile', 'compiler', 'runtime', 'segfault', 'syntax', 'deprecated', 'refactor', 'lint',
            'npm', 'pip', 'yarn', 'pnpm', 'cargo', 'gradle', 'maven', 'webpack', 'vite', 'git',
            'install', 'import', 'module', 'package', 'dependency', 'function', 'method', 'class',
            'api', 'sdk', 'cli', 'regex', 'async', 'await', 'promise', 'callback', 'closure',
            'recursion', 'pointer', 'malloc', 'thread', 'mutex', 'deadlock', 'null', 'undefined',
            'typeerror', 'valueerror', 'nullpointer', 'json', 'yaml', 'xml', 'http', 'https', 'oauth',
            'jwt', 'crud', 'orm', 'graphql', 'grpc', 'websocket', 'docker', 'kubernetes', 'k8s',
            'terraform', 'ansible', 'nginx', 'localhost', 'leetcode', 'boilerplate', 'stdout', 'stderr',
            // languages
            'python', 'javascript', 'typescript', 'java', 'kotlin', 'swift', 'rust', 'golang', 'ruby',
            'php', 'perl', 'scala', 'haskell', 'clojure', 'elixir', 'dart', 'cpp', 'csharp', 'bash',
            'powershell', 'sql',
            // frameworks / libs / infra
            'react', 'reactjs', 'vue', 'vuejs', 'angular', 'svelte', 'nextjs', 'nodejs', 'node',
            'express', 'django', 'flask', 'fastapi', 'spring', 'springboot', 'rails', 'laravel',
            'dotnet', 'pandas', 'numpy', 'scipy', 'tensorflow', 'pytorch', 'keras', 'sklearn', 'opencv',
            'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'kafka', 'rabbitmq',
        ]),
        phrases: ['how to', 'how do i', 'not working', 'does not work', "doesn't work", 'stack trace',
            'type error', 'null pointer', 'command not found', 'cannot find module', 'permission denied',
            'code example', 'sample code', 'unit test', 'memory leak', 'race condition'],
        patterns: [
            /\b[a-z_]\w*\s*\([^)]*\)/i,                 // a function call: foo(bar)
            /=>|->|::|&&|\|\||===|!==|\+\+|--\w/,       // code operators / CLI flags
            /\.(js|jsx|ts|tsx|py|java|rb|go|rs|cpp|cc|hpp|cs|php|sh|sql|html|css|json|ya?ml|xml|toml|ipynb)\b/i,
            /#include|\bdef\s|\bfunction\s|\bclass\s|console\.log|print\(|System\.out|public\s+static/i,
            /\bE\d{3,}\b|\bERR_[A-Z_]+\b|\b[45]\d{2}\s+(error|status)\b/i,
        ],
    },
    academic: {
        engines: ['arxiv', 'google', 'wikipedia'],
        terms: new Set([
            'paper', 'papers', 'arxiv', 'preprint', 'preprints', 'thesis', 'dissertation', 'journal',
            'journals', 'citation', 'citations', 'doi', 'theorem', 'lemma', 'corollary', 'proof',
            'hypothesis', 'methodology', 'empirical', 'benchmark', 'benchmarks', 'dataset', 'datasets',
            'sota', 'ablation', 'quantum', 'relativity', 'entanglement', 'qubit', 'qubits', 'neural',
            'transformer', 'transformers', 'embedding', 'embeddings', 'diffusion', 'reinforcement',
            'supervised', 'unsupervised', 'backpropagation', 'convolutional', 'cnn', 'rnn', 'lstm',
            'gan', 'llm', 'nlp', 'bioinformatics', 'genomics', 'proteomics', 'cosmology', 'astrophysics',
            'topology', 'manifold', 'eigenvalue', 'tensor', 'stochastic', 'bayesian', 'markov', 'entropy',
            'thermodynamics', 'photonics', 'superconductor', 'perturbation', 'asymptotic',
        ]),
        phrases: ['et al', 'state of the art', 'research paper', 'peer reviewed', 'literature review',
            'novel approach', 'related work', 'open problem'],
        patterns: [
            /\b\d{4}\.\d{4,5}\b/,     // arXiv identifier, e.g. 2401.01234
            /\bet\s+al\.?\b/i,
            /\barxiv[:\/]/i,
        ],
    },
    social: {
        engines: ['reddit', 'x', 'ddg', 'google'],
        terms: new Set([
            'reddit', 'subreddit', 'redditor', 'redditors', 'opinion', 'opinions', 'review', 'reviews',
            'recommend', 'recommendation', 'recommendations', 'thoughts', 'experience', 'experiences',
            'anecdotal', 'community', 'discussion', 'discuss', 'debate', 'rant', 'drama', 'aita', 'tifu',
            'eli5', 'ama', 'twitter', 'tweet', 'tweets', 'retweet', 'hashtag', 'viral', 'trending',
            'meme', 'memes', 'influencer', 'cringe', 'underrated', 'overrated', 'circlejerk',
        ]),
        phrases: ['is it worth', 'worth it', 'should i', 'anyone else', 'what do you think',
            'pros and cons', 'real world', 'in practice', 'better than', 'hot take', 'change my mind'],
        patterns: [
            /\br\/\w+/i,               // r/subreddit
            /(^|\s)@\w{2,}/,           // @handle
            /\bvs\.?\b|\bversus\b/i,   // X vs Y comparisons
            /\bbest\b|\bworst\b|\btop\s+\d+/i,
        ],
    },
    news: {
        engines: ['ddg', 'google', 'bing'],
        terms: new Set([
            'news', 'breaking', 'headline', 'headlines', 'latest', 'today', 'tonight', 'yesterday',
            'update', 'updates', 'announced', 'announcement', 'release', 'released', 'launch', 'launched',
            'unveiled', 'report', 'reports', 'election', 'elections', 'stock', 'stocks', 'market',
            'markets', 'earnings', 'ipo', 'layoffs', 'merger', 'acquisition', 'lawsuit', 'verdict',
            'weather', 'forecast', 'scores', 'standings',
        ]),
        phrases: ['latest news', 'breaking news', 'this week', 'right now', 'just announced'],
        patterns: [
            /\b20(1\d|2\d)\b/,          // a recent year, 2010–2029
        ],
    },
    reference: {
        engines: ['wikipedia', 'ddg', 'google'],
        terms: new Set([
            'definition', 'define', 'meaning', 'meanings', 'biography', 'history', 'origin', 'origins',
            'etymology', 'capital', 'population', 'founded', 'invented', 'discovered', 'timeline', 'facts',
        ]),
        phrases: ['who is', 'who was', 'who were', 'what is', 'what are', 'what was', 'when did',
            'when was', 'where is', 'where was', 'why is', 'how many', 'history of', 'definition of',
            'meaning of', 'capital of', 'list of', 'difference between'],
        patterns: [
            /^(who|what|when|where|why|which)\b/i,   // an encyclopedic question
        ],
    },
};

// Entity detection is structural, not keyword-based, so it lives outside CATEGORIES.
const RE_IP = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_DOMAIN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const RE_TLD = /\.[a-z]{2,}$/i;
const RE_HANDLEISH = /^[a-z0-9][a-z0-9_.-]{1,29}$/i; // username-shaped single token

// Score the query against one category's term/phrase/pattern signals.
function scoreCategory(cat, tokenSet, raw) {
    const matched = [];
    let score = 0;
    for (const t of tokenSet) {
        if (cat.terms.has(t)) { score += WEIGHTS.term; matched.push(t); }
    }
    for (const p of cat.phrases) {
        if (raw.includes(p)) { score += WEIGHTS.phrase; matched.push(`"${p}"`); }
    }
    for (const re of cat.patterns) {
        if (re.test(raw)) { score += WEIGHTS.pattern; matched.push(re.source); }
    }
    return { score, matched };
}

// Structural entity check → an OSINT lookup target (IP / domain / username).
// Multi-word queries are never entities (OSINT only runs on single tokens).
function scoreEntity(raw) {
    if (/\s/.test(raw) || !raw) return { score: 0, matched: [] };
    if (RE_IP.test(raw)) return { score: 6, matched: ['ip'] };
    if (RE_DOMAIN.test(raw) && RE_TLD.test(raw)) return { score: 5, matched: ['domain'] };
    // A bare handle-ish token (has a digit/._- or is otherwise identifier-like) is a
    // plausible username; a plain dictionary word is only a weak signal.
    if (RE_HANDLEISH.test(raw)) return { score: /[0-9_.-]/.test(raw) ? 3 : 1, matched: ['username'] };
    return { score: 0, matched: [] };
}

/**
 * Classify a query and recommend engines.
 * @returns {{
 *   query: string,
 *   primary: string,                                  // top category, or 'general'
 *   categories: Array<{name,score,matched:string[]}>, // scored, desc, score>0 only
 *   engines: string[],                                // recommended, best-first, deduped
 *   runnable: string[],                               // engines Nexus actually ships
 * }}
 */
function classifyQuery(query) {
    const raw = String(query || '').toLowerCase().trim();
    const tokenSet = new Set(tokenize(raw));

    const scored = [];
    for (const [name, cat] of Object.entries(CATEGORIES)) {
        const { score, matched } = scoreCategory(cat, tokenSet, raw);
        if (score > 0) scored.push({ name, score, matched, engines: cat.engines });
    }
    const entity = scoreEntity(raw);
    if (entity.score > 0) scored.push({ name: 'entity', score: entity.score, matched: entity.matched, engines: ['osint'] });

    // Highest score first; ties fall back to declaration order (stable sort).
    scored.sort((a, b) => b.score - a.score);

    const selected = scored.filter(c => c.score >= SELECT_THRESHOLD);
    const primary = selected.length ? selected[0].name : 'general';

    // Union engines from selected categories (best-first), then the general
    // fallback, deduping while preserving first-seen order.
    const ordered = [];
    const seen = new Set();
    const push = e => { if (!seen.has(e)) { seen.add(e); ordered.push(e); } };
    for (const c of selected) for (const e of c.engines) push(e);
    for (const e of GENERAL_ENGINES) push(e);

    return {
        query: String(query || ''),
        primary,
        categories: scored.map(({ name, score, matched }) => ({ name, score, matched })),
        engines: ordered,
        runnable: ordered.filter(e => ENGINE_REGISTRY[e] && ENGINE_REGISTRY[e].implemented),
    };
}

module.exports = { classifyQuery, ENGINE_REGISTRY, CATEGORIES, GENERAL_ENGINES };

#!/usr/bin/env node
// Prints aggregated Nexus usage/perf stats from metrics.jsonl — the numbers you
// can quote on a resume. Run:  node backend/stats.js  [--json]
const { summarize } = require('./util/metrics');

const asJson = process.argv.includes('--json');
const s = summarize();

if (asJson) {
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
}

if (!s || !s.searches) {
    console.log('No searches recorded yet. Run some searches, then re-run this.');
    process.exit(0);
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const row = (label, value) => console.log(`  ${label.padEnd(30)} ${value}`);

console.log('\n  Nexus — usage & performance stats');
console.log('  ' + '─'.repeat(44));
row('Searches served', s.searches);
row('Unique queries', s.uniqueQueries);
row('Avg results / search', s.avgResultsPerSearch);
row('Most results in one search', s.maxResultsInOneSearch);
row('Total results served', s.totalResultsServed.toLocaleString());
row('Total results aggregated', s.totalResultsAggregated.toLocaleString());
row('Off-topic filtered out', s.offTopicFilteredOut.toLocaleString());
row('Duplicates removed', s.duplicatesRemoved.toLocaleString());
row('Noise reduction rate', pct(s.noiseReductionRate));
row('Cache hit rate', pct(s.cacheHitRate));
row('Time-to-first-result p50/p95', `${s.timeToFirstResultMs.p50} / ${s.timeToFirstResultMs.p95} ms`);
row('Full-completion p50/p95/max', `${s.latencyMs.p50} / ${s.latencyMs.p95} / ${s.latencyMs.max} ms`);

console.log('\n  Per-engine (avg latency · avg results · error rate)');
console.log('  ' + '─'.repeat(44));
for (const [name, e] of Object.entries(s.engines)) {
    row(name, `${e.avgLatencyMs} ms · ${e.avgResults} · ${pct(e.errorRate)} err`);
}

console.log('\n  Suggested resume phrasing');
console.log('  ' + '─'.repeat(44));
console.log(`  • Built a metasearch engine aggregating ${Object.keys(s.engines).length} sources in`);
console.log(`    parallel, averaging ${s.avgResultsPerSearch} results/query (peak ${s.maxResultsInOneSearch}).`);
console.log(`  • Cut result noise ${pct(s.noiseReductionRate)} via a BM25 + rank-fusion pipeline`);
console.log(`    with relevance filtering and URL de-duplication.`);
console.log(`  • Streamed first results in a p95 of ${s.timeToFirstResultMs.p95} ms (Server-Sent`);
console.log(`    Events), with a ${pct(s.cacheHitRate)} cache hit rate on repeat queries.`);
console.log('');

// Lightweight usage/perf metrics. Every search appends one JSON line to
// metrics.jsonl (append-only, cheap, non-blocking). `summarize()` reads the file
// back and computes aggregates for the /api/stats endpoint and the stats CLI —
// the numbers you can quote on a resume (throughput, latency percentiles, cache
// hit rate, how much noise the relevance filter removes).
const fs = require('fs');
const path = require('path');

const METRICS_FILE = path.join(__dirname, '..', 'metrics.jsonl');
const metricsStream = fs.createWriteStream(METRICS_FILE, { flags: 'a' });

// High-resolution millisecond timer.
function timer() {
    const start = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - start) / 1e6;
}

// Count all result items across every category in an engine payload.
function countResults(data) {
    if (!data || typeof data !== 'object') return 0;
    return Object.values(data).reduce(
        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
        0
    );
}

function record(entry) {
    try {
        metricsStream.write(JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    } catch {
        // Metrics must never break a search.
    }
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
    return sortedAsc[Math.max(0, idx)];
}

function mean(nums) {
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function readRecords(file = METRICS_FILE) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf-8');
    } catch {
        return [];
    }
    const records = [];
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
            records.push(JSON.parse(line));
        } catch {
            // skip malformed line
        }
    }
    return records;
}

function summarize(file = METRICS_FILE) {
    const searches = readRecords(file).filter(r => r.type === 'search');
    if (searches.length === 0) {
        return { searches: 0, note: 'No searches recorded yet.' };
    }

    const uniqueQueries = new Set(searches.map(s => (s.query || '').trim().toLowerCase()));
    const cacheHits = searches.filter(s => s.cacheHit).length;

    // Latency is only meaningful for real work (cache misses do the fan-out).
    const missLatencies = searches.filter(s => !s.cacheHit).map(s => s.totalMs).sort((a, b) => a - b);
    // Perceived latency: how fast the first result reaches a streaming client.
    const firstResultLatencies = searches
        .filter(s => typeof s.firstResultMs === 'number')
        .map(s => s.firstResultMs)
        .sort((a, b) => a - b);

    const rawTotals = searches.map(s => s.rawTotal || 0);
    const finalTotals = searches.map(s => s.finalTotal || 0);
    const filteredOut = searches.reduce((a, s) => a + (s.filteredOut || 0), 0);
    const dedupedOut = searches.reduce((a, s) => a + (s.dedupedOut || 0), 0);
    const totalRaw = rawTotals.reduce((a, b) => a + b, 0);

    // Per-engine aggregates.
    const engineMap = new Map();
    for (const s of searches) {
        for (const e of s.engines || []) {
            if (!engineMap.has(e.name)) engineMap.set(e.name, { calls: 0, errors: 0, ms: [], counts: [] });
            const agg = engineMap.get(e.name);
            agg.calls++;
            if (!e.ok) agg.errors++;
            if (typeof e.ms === 'number') agg.ms.push(e.ms);
            if (typeof e.count === 'number') agg.counts.push(e.count);
        }
    }
    const engines = {};
    for (const [name, a] of engineMap) {
        engines[name] = {
            calls: a.calls,
            errorRate: +(a.errors / a.calls).toFixed(3),
            avgLatencyMs: +mean(a.ms).toFixed(1),
            avgResults: +mean(a.counts).toFixed(1),
        };
    }

    return {
        searches: searches.length,
        uniqueQueries: uniqueQueries.size,
        cacheHitRate: +(cacheHits / searches.length).toFixed(3),
        avgResultsPerSearch: +mean(finalTotals).toFixed(1),
        maxResultsInOneSearch: Math.max(...finalTotals),
        totalResultsServed: finalTotals.reduce((a, b) => a + b, 0),
        totalResultsAggregated: totalRaw,
        offTopicFilteredOut: filteredOut,
        duplicatesRemoved: dedupedOut,
        noiseReductionRate: totalRaw ? +((filteredOut + dedupedOut) / totalRaw).toFixed(3) : 0,
        latencyMs: {
            p50: +percentile(missLatencies, 50).toFixed(0),
            p95: +percentile(missLatencies, 95).toFixed(0),
            max: +Math.max(0, ...missLatencies).toFixed(0),
        },
        timeToFirstResultMs: {
            p50: +percentile(firstResultLatencies, 50).toFixed(0),
            p95: +percentile(firstResultLatencies, 95).toFixed(0),
        },
        engines,
    };
}

module.exports = { record, summarize, timer, countResults, METRICS_FILE };

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { TTLCache } = require('./util/cache');
const { assertPublicUrl } = require('./util/ssrf');
const { resolvePython } = require('./util/python');
const { rankResults, filterRelevant } = require('./util/ranking');
const metrics = require('./util/metrics');

// Text-bearing tabs get the "must contain a query term" relevance filter. Visual
// browse tabs (images/videos/books) are left unfiltered — their metadata is thin.
const TEXT_TABS = new Set(['web', 'news', 'documents', 'academic', 'code', 'community', 'reference', 'osint']);

// --- Non-blocking File Logger ---
// A shared append stream keeps logging off the synchronous I/O path so it no
// longer blocks the event loop on every request.
const LOG_FILE = path.join(__dirname, 'nexus.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
// Strip newlines from interpolated values to prevent log-injection/forging.
function sanitize(msg) {
  return String(msg).replace(/[\r\n]+/g, ' ');
}
function logInfo(msg) {
  logStream.write(`[${new Date().toISOString()}] INFO: ${sanitize(msg)}\n`);
}
function logErrorLevel(msg) {
  logStream.write(`[${new Date().toISOString()}] ERROR: ${sanitize(msg)}\n`);
}

// Import all engine modules
const ddg = require('./engines/ddg');
const wikipedia = require('./engines/wikipedia');
const stackexchange = require('./engines/stackexchange');
const reddit = require('./engines/reddit');
const arxiv = require('./engines/arxiv');
const searxng = require('./engines/searxng');
const osint = require('./engines/osint');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8000;
const ERROR_LOG_FILE = 'error.log';

// Cache the merged (pre-rank) engine results per query so repeat searches skip
// the whole upstream fan-out. Ranking/sort/pagination still run per request.
const searchCache = new TTLCache({ ttlMs: 5 * 60 * 1000, maxEntries: 500 });

async function logError(errorDetails) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...errorDetails
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    await fs.promises.appendFile(ERROR_LOG_FILE, logLine); // Use fs.promises for this async operation
  } catch (err) {
    logErrorLevel('Failed to write to error log: ' + err.message); // Replaced console.error
  }
}

// All engines keyed by name
const ENGINES = {
  ddg,
  searxng,
  wikipedia,
  stackexchange,
  reddit,
  arxiv,
  osint
};

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  let page = parseInt(req.query.page) || 1;
  // Default to date-descending; only fall back to relevance when explicitly asked.
  const sortBy = req.query.sort === 'relevance' ? 'relevance' : 'date';

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  logInfo(`Searching: "${query}" (sort=${sortBy}, page=${page})`); // Replaced console.log

  const totalTimer = metrics.timer();
  const engineStats = [];
  const cacheKey = query.trim().toLowerCase();
  let merged = searchCache.get(cacheKey);
  const cacheHit = !!merged;

  if (cacheHit) {
    logInfo(`Cache hit for "${query}"`);
  } else {
    // Fire all engines in parallel, timing each independently.
    const engineNames = Object.keys(ENGINES);
    const promises = engineNames.map(name => {
      const engineTimer = metrics.timer();
      return ENGINES[name].search(query)
        .then(data => {
          engineStats.push({ name, ms: +engineTimer().toFixed(1), ok: true, count: metrics.countResults(data) });
          return data;
        })
        .catch(err => {
          engineStats.push({ name, ms: +engineTimer().toFixed(1), ok: false, count: 0 });
          logErrorLevel(`${name} failed: ${err.message}`); // Replaced console.error
          return {};
        });
    });

    const settled = await Promise.allSettled(promises);

    // Merge all results by content type
    merged = {
      web: [],
      images: [],
      videos: [],
      news: [],
      documents: [],
      books: [],
      code: [],
      academic: [],
      community: [],
      reference: [],
      osint: [],
      nsfw: []
    };

    settled.forEach((result, i) => {
      const data = result.status === 'fulfilled' ? result.value : {};
      for (const type of Object.keys(merged)) {
        if (Array.isArray(data[type])) {
          merged[type].push(...data[type]);
        }
      }
      const count = Object.values(data).flat().length;
      if (count > 0) logInfo(`${engineNames[i]}: ${count} results`); // Replaced console.log
    });

    searchCache.set(cacheKey, merged);
  }

  // Rank every category (not just web). Ranking returns fresh arrays, so the
  // cached merged object stays untouched and can be re-ranked with a different
  // sort on the next request. Track how much the filter and dedup remove.
  const ranked = {};
  let rawCount = 0;
  let afterFilter = 0;
  for (const type of Object.keys(merged)) {
    rawCount += merged[type].length;
    const items = TEXT_TABS.has(type) ? filterRelevant(merged[type], query) : merged[type];
    afterFilter += items.length;
    ranked[type] = rankResults(items, query, sortBy);
  }

  const totalResults = Object.values(ranked).reduce((sum, arr) => sum + arr.length, 0);
  logInfo(`Total: ${totalResults} results across all types`); // Replaced console.log

  metrics.record({
    type: 'search',
    endpoint: 'rest',
    query,
    sort: sortBy,
    cacheHit,
    engines: engineStats,
    rawTotal: rawCount,
    filteredOut: rawCount - afterFilter,      // off-topic (no query term)
    dedupedOut: afterFilter - totalResults,   // duplicate URLs collapsed
    finalTotal: totalResults,
    totalMs: +totalTimer().toFixed(1)
  });

  // Return the full ranked web list (client paginates); other tabs as ranked arrays.
  res.json({
    query,
    sort: sortBy,
    totalResults,
    web: { total: ranked.web.length, cards: ranked.web },
    images: ranked.images,
    videos: ranked.videos,
    news: ranked.news,
    documents: ranked.documents,
    books: ranked.books,
    code: ranked.code,
    academic: ranked.academic,
    community: ranked.community,
    reference: ranked.reference,
    osint: ranked.osint,
    nsfw: ranked.nsfw
  });
});

// --- Dynamic Date Fallback Endpoint ---
app.get('/api/resolve-date', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url' });

  // SSRF guard: only fetch public http(s) hosts. Blocks loopback/private ranges
  // and cloud metadata endpoints, including DNS-rebinding attempts.
  const check = await assertPublicUrl(targetUrl);
  if (!check.ok) {
    logErrorLevel(`resolve-date blocked: ${check.reason} (${targetUrl})`);
    return res.status(400).json({ error: `URL not allowed: ${check.reason}` });
  }

  // Cross-platform interpreter resolution (was hardcoded to a Windows venv path).
  const pythonExecutable = resolvePython();
  const scriptPath = path.resolve(__dirname, 'engines', 'fallback_date.py');

  const { spawn } = require('child_process');
  const pyProcess = spawn(pythonExecutable, [scriptPath, targetUrl], { timeout: 20000 });

  let output = '';
  let responded = false;
  const respond = (payload) => {
    if (responded) return;
    responded = true;
    res.json(payload);
  };

  pyProcess.stdout.on('data', (data) => output += data.toString());
  pyProcess.on('error', () => respond({ url: targetUrl, publishedDate: null }));

  pyProcess.on('close', (code) => {
    try {
      if (code === 0 && output) {
        respond(JSON.parse(output.trim()));
      } else {
        respond({ url: targetUrl, publishedDate: null });
      }
    } catch (e) {
      respond({ url: targetUrl, publishedDate: null });
    }
  });
});

app.get('/api/search/stream', (req, res) => {
  const query = req.query.q;
  // Default to date-descending; only fall back to relevance when explicitly asked.
  const sortBy = req.query.sort === 'relevance' ? 'relevance' : 'date';

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  // Setup SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Important: Flush headers immediately
  res.write('\n');

  logInfo(`Streaming Search: "${query}" (sort=${sortBy})`); // Replaced console.log

  const totalTimer = metrics.timer();
  const engineStats = [];
  let rawTotal = 0;
  let filteredTotal = 0;
  let firstResultMs = null; // time until the user sees the first non-empty result

  const engineNames = Object.keys(ENGINES);
  let completed = 0;

  engineNames.forEach(name => {
    const engineTimer = metrics.timer();
    ENGINES[name].search(query)
      .then(data => {
        const rawCount = metrics.countResults(data);

        // Drop off-topic results (no query term present) from text tabs before
        // streaming, so date-sorted results aren't polluted by unrelated items.
        const filtered = {};
        for (const [type, items] of Object.entries(data)) {
          filtered[type] = (Array.isArray(items) && TEXT_TABS.has(type))
            ? filterRelevant(items, query)
            : items;
        }

        const count = metrics.countResults(filtered);
        rawTotal += rawCount;
        filteredTotal += count;
        if (firstResultMs === null && count > 0) firstResultMs = +totalTimer().toFixed(1);
        engineStats.push({ name, ms: +engineTimer().toFixed(1), ok: true, count });

        // Send the payload for this specific engine
        res.write(`data: ${JSON.stringify({
          type: 'engine_result',
          engine: name,
          data: filtered
        })}\n\n`);

        if (count > 0) logInfo(`Streamed ${name}: ${count} results`); // Replaced console.log
      })
      .catch(err => {
        engineStats.push({ name, ms: +engineTimer().toFixed(1), ok: false, count: 0 });
        logErrorLevel(`Stream ${name} failed: ${err.message}`); // Replaced console.error
        res.write(`data: ${JSON.stringify({
          type: 'engine_error',
          engine: name,
          error: err.message
        })}\n\n`);
      })
      .finally(() => {
        completed++;
        if (completed === engineNames.length) {
          logInfo(`Streaming complete for "${query}"`); // Replaced console.log
          metrics.record({
            type: 'search',
            endpoint: 'stream',
            query,
            sort: sortBy,
            cacheHit: false,
            engines: engineStats,
            rawTotal,
            filteredOut: rawTotal - filteredTotal, // off-topic (no query term)
            dedupedOut: 0,                          // stream doesn't cross-engine dedup
            finalTotal: filteredTotal,
            firstResultMs,                          // time-to-first-result (perceived latency)
            totalMs: +totalTimer().toFixed(1)
          });
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        }
      });
  });

  req.on('close', () => {
    // Client closed the connection early
    completed = engineNames.length; // Ensure process doesn't try to write to closed connection
  });
});

// Aggregated usage/perf metrics (throughput, latency percentiles, cache hit
// rate, noise-reduction) computed from metrics.jsonl.
app.get('/api/stats', (req, res) => {
  try {
    res.json(metrics.summarize());
  } catch (err) {
    logErrorLevel(`stats failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

app.post('/api/log-error', (req, res) => {
  try {
    logError({
      type: 'client_error',
      ...req.body
    });
    res.json({ success: true });
  } catch (error) {
    logErrorLevel(`Failed to log client error: ${error.message}`); // Replaced console.error
    res.status(500).json({ error: 'Failed to log error' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 8000; // Moved and updated PORT definition
  app.listen(PORT, () => {
    logInfo(`Nexus backend running on port ${PORT}`); // Replaced console.log
    logInfo(`Engines loaded: ${Object.keys(ENGINES).join(', ')}`); // Replaced console.log
  });
}

module.exports = app;

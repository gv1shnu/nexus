const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Changed from fs.promises
const path = require('path');

// --- Simple File Logger ---
const LOG_FILE = path.join(__dirname, 'nexus.log');
function logInfo(msg) {
  const line = `[${new Date().toISOString()}] INFO: ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}
function logErrorLevel(msg) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Import all engine modules
const ddg = require('./engines/ddg');
const wikipedia = require('./engines/wikipedia');
const stackexchange = require('./engines/stackexchange');
const reddit = require('./engines/reddit');
const arxiv = require('./engines/arxiv');
const searxng = require('./engines/searxng');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8000;
const PAGE_SIZE = 10;
const ERROR_LOG_FILE = 'error.log';

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

function rankResults(results, query, sortBy = 'relevance') {
  const seenUrls = new Set();
  const lowerQuery = query.toLowerCase();
  const now = Date.now();

  const scored = results.map(item => {
    let score = 0;
    let domain = 'unknown';

    try {
      domain = new URL(item.url).hostname;
    } catch { }

    // Parse published date
    let publishedDate = null;
    if (item.publishedDate) {
      const parsed = new Date(item.publishedDate);
      if (!isNaN(parsed.getTime())) {
        publishedDate = parsed.toISOString();

        const ageMs = now - parsed.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays <= 7) score += 60;
        else if (ageDays <= 30) score += 30;
        else if (ageDays <= 365) score += 10;
      }
    }

    // Engine-specific weight (also match searxng-* engines)
    const baseEngine = item.engine?.split('-')[0] || '';
    score += ENGINE_WEIGHTS[item.engine] || ENGINE_WEIGHTS[baseEngine] || 5;

    if (TRUSTED_DOMAINS.some(d => domain.includes(d))) score += 50;
    score += Math.max(0, 30 - item.url.length / 8);
    if (item.title?.toLowerCase().includes(lowerQuery)) score += 40;
    if (item.title?.length < 60) score += 15;
    if (domain.includes('stackoverflow.com')) score += 20;
    if (domain.includes('github.com')) score += 20;

    return { ...item, domain, score, publishedDate };
  });

  // Deduplicate
  const unique = scored.filter(item => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  // Sort
  if (sortBy === 'date') {
    unique.sort((a, b) => {
      if (a.publishedDate && b.publishedDate) return new Date(b.publishedDate) - new Date(a.publishedDate);
      if (a.publishedDate) return -1;
      if (b.publishedDate) return 1;
      return b.score - a.score;
    });
  } else {
    unique.sort((a, b) => b.score - a.score);
  }

  return unique;
}

function paginate(results, page) {
  if (page < 1) page = 1;
  const total = results.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * PAGE_SIZE;

  return {
    total,
    page,
    totalPages,
    cards: results.slice(start, start + PAGE_SIZE)
  };
}

// All engines keyed by name
const ENGINES = {
  ddg,
  searxng,
  wikipedia,
  stackexchange,
  reddit,
  arxiv
};

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  let page = parseInt(req.query.page) || 1;
  const sortBy = req.query.sort === 'date' ? 'date' : 'relevance';

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  logInfo(`Searching: "${query}" (sort=${sortBy}, page=${page})`); // Replaced console.log

  // Fire all engines in parallel
  const engineNames = Object.keys(ENGINES);
  const promises = engineNames.map(name =>
    ENGINES[name].search(query).catch(err => {
      logErrorLevel(`${name} failed: ${err.message}`); // Replaced console.error
      return {};
    })
  );

  const settled = await Promise.allSettled(promises);

  // Merge all results by content type
  const merged = {
    web: [],
    images: [],
    videos: [],
    news: [],
    documents: [],
    books: [],
    code: [],
    academic: [],
    community: []
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

  // Rank web results
  merged.web = rankResults(merged.web, query, sortBy);

  // Paginate web (primary tab)
  const webPaginated = paginate(merged.web, page);

  const totalResults = Object.values(merged).reduce((sum, arr) => sum + arr.length, 0);
  logInfo(`Total: ${totalResults} results across all types`); // Replaced console.log

  res.json({
    query,
    sort: sortBy,
    totalResults,
    web: webPaginated,
    images: merged.images,
    videos: merged.videos,
    news: merged.news,
    documents: merged.documents,
    books: merged.books,
    code: merged.code,
    academic: merged.academic,
    community: merged.community
  });
});

// --- Dynamic Date Fallback Endpoint ---
app.get('/api/resolve-date', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url' });

  // Use the virtual environment python specifically
  const pythonExecutable = path.resolve(__dirname, '..', 'venv', 'Scripts', 'python.exe');
  const scriptPath = path.resolve(__dirname, 'engines', 'fallback_date.py');

  const { spawn } = require('child_process');
  const pyProcess = spawn(pythonExecutable, [scriptPath, targetUrl]);

  let output = '';
  pyProcess.stdout.on('data', (data) => output += data.toString());

  pyProcess.on('close', (code) => {
    try {
      if (code === 0 && output) {
        const parsed = JSON.parse(output.trim());
        res.json(parsed);
      } else {
        res.json({ url: targetUrl, publishedDate: null });
      }
    } catch (e) {
      res.json({ url: targetUrl, publishedDate: null });
    }
  });
});

app.get('/api/search/stream', (req, res) => {
  const query = req.query.q;
  const sortBy = req.query.sort === 'date' ? 'date' : 'relevance';

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

  const engineNames = Object.keys(ENGINES);
  let completed = 0;

  engineNames.forEach(name => {
    ENGINES[name].search(query)
      .then(data => {
        // Send the payload for this specific engine
        res.write(`data: ${JSON.stringify({
          type: 'engine_result',
          engine: name,
          data: data
        })}\n\n`);

        const count = Object.values(data).flat().length;
        if (count > 0) logInfo(`Streamed ${name}: ${count} results`); // Replaced console.log
      })
      .catch(err => {
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

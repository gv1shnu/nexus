# Nexus

**A metasearch engine that goes wide.** No API keys, no tracking. You type one query,
it fans out to a bunch of sources at once, then merges and ranks everything into a single feed.

The idea is quantity over raw speed: instead of trusting one engine, Nexus asks DuckDuckGo,
a self-hosted SearXNG instance, Wikipedia, StackOverflow, Reddit, and arXiv all at the same
time — plus a small OSINT module for looking up usernames and domains — and stitches the
results together. You get tabs for web, images, videos, news, docs, books, code, academic,
Wikipedia, community, OSINT, and NSFW.

---

## Sources & tabs

| Source | How it's queried | Feeds |
|--------|------------------|-------|
| **SearXNG** (self-hosted) | aggregator over Docker | Web · Images · NSFW |
| **DuckDuckGo** (`ddgs` worker + Instant Answer) | Python lib / REST | Web · Videos · News · Books · Docs |
| **Wikipedia** | REST/JSON | Wikipedia |
| **arXiv** | Atom/XML | Academic |
| **StackOverflow** (StackExchange) | REST/JSON | Code |
| **Reddit** (old.reddit scrape) | HTML scrape | Community · NSFW |
| **OSINT** (username + domain lookups) | HTTP / crt.sh | OSINT |

A couple of things worth knowing:

- **Images and NSFW come from SearXNG** (Bing/Google/Flickr/Pinterest/…), not DuckDuckGo —
  DDG's image endpoint gets 403'd constantly, so it's not worth relying on. NSFW is just image
  search with safesearch off, plus safesearch-off Reddit posts shown as link cards in the same tab.
- **OSINT only kicks in when your query looks like a single thing**, not a phrase — a **username**
  (checks ~15 platforms for that handle, Sherlock-style) or a **domain** (finds subdomains from
  certificate-transparency logs via crt.sh, theHarvester-style).

---

## How it fits together

```
                         ┌──────────────────────────────┐
  Browser                │  Express backend (port 8000) │
  (frontend/index.js)    │                              │
      │  ▲               │  /api/search        (ranked) │
      │  │ SSE / fetch   │  /api/search/stream (live)   │
      │  │               │  /api/resolve-date  (SSRF-   │
      ▼  │               │  /api/stats          guarded)│
  live-streamed          └───────────────┬──────────────┘
  or ranked results                      │ parallel fan-out
      ┌────────────┬───────────┬─────────┼────────┬──────────┬─────────┬────────┐
      ▼            ▼           ▼         ▼        ▼          ▼         ▼        ▼
   SearXNG    DuckDuckGo   Wikipedia   arXiv   Stack-     Reddit    OSINT   (metrics)
   (Docker)   (ddgs        (REST)      (XML)   Overflow   (scrape)  module
              worker)                          (REST)
```

The backend also serves the static frontend, so the whole thing runs as one process.

### How results get ranked

Ranking blends two signals, each squashed to `[0,1]` so neither one wins just by having a
bigger scale, with a few small tie-breakers on top — the details live in
[`backend/util/ranking.js`](backend/util/ranking.js):

- **BM25** ([`util/bm25.js`](backend/util/bm25.js)) — classic Okapi BM25 over each result's title
  and content, so term frequency, rarity, and document length all factor in.
- **Reciprocal Rank Fusion** — `score = Σ 1/(60 + rank)` across engines. If several engines
  independently surface the same URL near the top, it gets a boost.
- **Priors** — gentle nudges for source trust and recency to settle ties.

There's also a relevance filter that throws out results whose title and content contain *none*
of your query terms, so the text tabs don't fill up with loosely-related junk.

### Two ways to search

| Sort mode | Endpoint | Why it works this way |
|-----------|----------|------------------------|
| **Date** (default) | `/api/search/stream` (SSE) | Results stream in live, newest first, so it feels fast. |
| **Relevance** | `/api/search` (blocking) | BM25 + RRF need the whole result set at once, so there's nothing to stream. |

### Bits I'm happy with

- **A Python worker that stays warm** ([`engines/ddg_worker.py`](backend/engines/ddg_worker.py) +
  [`util/pyworker.js`](backend/util/pyworker.js)) — the `ddgs` interpreter is kept alive and
  handled over a thread pool, instead of paying Python's startup cost on every single search.
- **Metrics** ([`util/metrics.js`](backend/util/metrics.js)) — each search logs per-engine latency,
  result counts, cache hits, and how much the filter/dedup step trimmed, to `metrics.jsonl`.
  You can see it all at `/api/stats`, the [`/stats`](frontend/stats.html) dashboard, or
  `node backend/stats.js`.
- **An SSRF guard** ([`util/ssrf.js`](backend/util/ssrf.js)) — `/api/resolve-date` will only fetch
  public `http(s)` hosts. Loopback, private ranges, and cloud-metadata IPs are blocked, and it
  re-checks after DNS resolution so a rebinding trick can't sneak through.
- **A small TTL cache** ([`util/cache.js`](backend/util/cache.js)) so repeated queries skip the
  whole fan-out.
- **Parallel pagination** — Wikipedia / arXiv / StackOverflow pages are fetched side by side.
- **Python that resolves anywhere** ([`util/python.js`](backend/util/python.js)) — it finds a
  project venv or a system `python3`, whatever OS you're on.

---

## What you need

- **Node.js** 18+
- **Python** 3.10+ (for the DuckDuckGo `ddgs` worker and date extraction)
- **Docker** (optional — only if you want SearXNG, which powers the Web, Images, and NSFW tabs)

## Getting set up

```bash
git clone https://github.com/gv1shnu/nexus.git && cd nexus

# Node deps
npm install

# Python deps (the backend auto-detects this venv)
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Optional: SearXNG for the Web / Images / NSFW tabs
cd backend && docker compose up -d && cd ..
```

## Running it

The backend serves the frontend too, so it's a single command:

```bash
# With SearXNG running:
SEARXNG_URL=http://localhost:8080 node backend/server.js

# Or without it — SearXNG-fed tabs just stay empty:
node backend/server.js
```

Then open <http://localhost:8000> (and <http://localhost:8000/stats.html> for the metrics dashboard).

> Engines fail on their own. If Python, Docker, or some upstream is down, that one gets skipped
> and everything else still comes back.

### Environment variables

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `8000` | Port the backend listens on |
| `SEARXNG_URL` | unset | SearXNG base URL (e.g. `http://localhost:8080`). Unset = SearXNG off |
| `NEXUS_PYTHON` | auto | Point at a specific Python interpreter |
| `NEXUS_DEBUG` | unset | Surface the Python worker's stderr in the logs |

---

## Tests

```bash
npm test                 # everything
npx jest ranking.test.js # just the ranking (BM25 + RRF + filter) tests
node backend/stats.js    # print aggregated stats from metrics.jsonl
```

- [`backend/ranking.test.js`](backend/ranking.test.js) — deterministic ranking + filter tests
- [`backend/server.test.js`](backend/server.test.js) — API tests with the engines mocked out
- [`backend/engines.test.js`](backend/engines.test.js) — live integration tests (these hit the network)

---

## Where it's headed

- **Deeper OSINT** — cut username false positives with per-site fingerprints, and add email lookups
  (Holehe) plus an entity-correlation graph (Neo4j)
- **Redis** for caching, and a real search index (OpenSearch / Meilisearch)
- **Rank tuning** — learn the weights on the BM25 / RRF blend instead of hand-picking them

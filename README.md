# Nexus

**A metasearch engine — quantity over speed.**
No API keys required. No tracking. One query, fanned out across many sources, merged and ranked.

Nexus queries DuckDuckGo, a self-hosted SearXNG instance, Wikipedia, StackOverflow, Reddit,
and arXiv in parallel — plus an OSINT module for entity lookups — then fuses everything into a
single ranked feed with tabs for web, images, videos, news, docs, books, code, academic,
Wikipedia, community, OSINT, and NSFW results.

---

## Sources & tabs

| Source | Protocol | Feeds tab(s) |
|--------|----------|--------------|
| **SearXNG** (self-hosted) | aggregator (Docker) | Web · Images · NSFW |
| **DuckDuckGo** (`ddgs` worker + Instant Answer) | Python lib / REST | Web · Videos · News · Books · Docs |
| **Wikipedia** | REST/JSON | Wikipedia |
| **arXiv** | Atom/XML | Academic |
| **StackOverflow** (StackExchange) | REST/JSON | Code |
| **Reddit** (old.reddit scrape) | HTML scrape | Community · NSFW |
| **OSINT** (Sherlock / theHarvester / Shodan style) | HTTP / crt.sh / Shodan API | OSINT |

- **Images / NSFW** are sourced from SearXNG (Bing/Google/Flickr/Pinterest/…), which is far more
  reliable than DuckDuckGo's frequently-403'd image endpoint. NSFW = image search with safesearch
  **off**; Reddit NSFW posts (safesearch-off scrape) are surfaced as link cards in the same tab.
- **OSINT** only runs when the query looks like a single entity — a **username** (presence check
  across ~15 platforms, Sherlock-style), a **domain** (subdomain discovery via certificate
  transparency / crt.sh, theHarvester-style), or an **IP** (Shodan host lookup, needs `SHODAN_API_KEY`).

---

## Architecture

```
                         ┌──────────────────────────────┐
  Browser (SPA)  ─────▶  │  Express backend (port 8000) │
  frontend/index.js      │                              │
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

### How results are ranked

Two complementary signals, each normalized to `[0,1]` so neither dominates by scale, plus light
priors — see [`backend/util/ranking.js`](backend/util/ranking.js):

- **BM25** ([`util/bm25.js`](backend/util/bm25.js)) — Okapi BM25 text relevance over each result's
  title + content (term-frequency saturation, IDF, document-length normalization). Word order and
  body text both count.
- **Reciprocal Rank Fusion (RRF)** — `score = Σ 1/(60 + rank)` across engines. A URL surfaced near
  the top by *multiple* independent engines is boosted; contributions are summed across engines
  before de-duplication.
- **Priors** — small nudges for source trust and recency to break ties.

A **relevance filter** additionally drops results whose title/content contains **none** of the
query terms, so text tabs aren't polluted by loosely-related upstream matches.

### Two search paths

| Sort mode          | Endpoint                     | Why                                                           |
|--------------------|------------------------------|---------------------------------------------------------------|
| **Date** (default) | `/api/search/stream` (SSE)   | Results stream in live, newest-first. Great perceived speed.  |
| **Relevance**      | `/api/search` (blocking)     | BM25 + RRF need the *whole* corpus, so they can't be streamed. |

### Notable engineering

- **Persistent Python worker** ([`engines/ddg_worker.py`](backend/engines/ddg_worker.py) +
  [`util/pyworker.js`](backend/util/pyworker.js)) — the `ddgs` interpreter stays warm and services
  requests over a thread pool, instead of cold-starting Python per search.
- **Metrics** ([`util/metrics.js`](backend/util/metrics.js)) — every search records per-engine
  latency, result counts, cache hits, and filter/dedup ratios to `metrics.jsonl`. Aggregated at
  `/api/stats`, the [`/stats`](frontend/stats.html) dashboard, and `node backend/stats.js`.
- **SSRF guard** ([`util/ssrf.js`](backend/util/ssrf.js)) — `/api/resolve-date` only fetches public
  `http(s)` hosts; loopback, private ranges, and cloud-metadata IPs are blocked, including
  DNS-rebinding attempts.
- **In-memory TTL cache** ([`util/cache.js`](backend/util/cache.js)) — repeat queries skip the
  upstream fan-out.
- **Parallel pagination** — Wikipedia / arXiv / StackOverflow pages are fetched concurrently.
- **Cross-platform Python resolution** ([`util/python.js`](backend/util/python.js)) — finds a
  project venv or a system `python3` on any OS.

---

## Requirements

- **Node.js** 18+
- **Python** 3.10+ (for the DuckDuckGo `ddgs` worker and date extraction)
- **Docker** (for SearXNG — powers the Web, Images, and NSFW tabs)

## Setup

```bash
git clone https://github.com/gv1shnu/nexus.git && cd nexus

# Node dependencies
npm install

# Python dependencies (virtualenv is auto-detected by the backend)
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# SearXNG (powers Web / Images / NSFW; runs with restart: unless-stopped)
cd backend && docker compose up -d && cd ..
```

## Run

```bash
# Terminal 1 — backend API (port 8000)
cd backend && node server.js

# Terminal 2 — frontend (static, port 3000)
cd frontend && npx serve . -l 3000
```

Then open <http://localhost:3000> (and <http://localhost:3000/stats.html> for the metrics dashboard).

> Engines fail independently: if Python, Docker, or a given upstream is unavailable, that engine
> is skipped and the rest still return results.

### Environment variables

| Variable          | Default  | Purpose                                        |
|-------------------|----------|------------------------------------------------|
| `PORT`            | `8000`   | Backend listen port                            |
| `NEXUS_PYTHON`    | auto     | Override the Python interpreter path           |
| `NEXUS_DEBUG`     | unset    | Surface the Python worker's stderr logging     |
| `SHODAN_API_KEY`  | unset    | Enables Shodan host lookups in the OSINT module |

---

## Test

```bash
npm test                 # all Jest suites
npx jest ranking.test.js # ranking (BM25 + RRF + filter) unit tests only
node backend/stats.js    # print aggregated usage/perf stats from metrics.jsonl
```

- [`backend/ranking.test.js`](backend/ranking.test.js) — deterministic BM25 + RRF + filter unit tests
- [`backend/server.test.js`](backend/server.test.js) — API tests with mocked engines
- [`backend/engines.test.js`](backend/engines.test.js) — live integration tests (need network)

---

## Roadmap

- **OSINT depth** — reduce username false positives with per-site fingerprints; add Holehe (emails)
  and an entity-correlation graph (Neo4j)
- **Redis** cache + a proper search index (OpenSearch / Meilisearch)
- **Rank tuning** — learned weights for the BM25 / RRF blend
```

"""
Persistent DuckDuckGo (ddgs) worker.

Replaces the old spawn-a-fresh-interpreter-per-request model. Node launches
this once and streams newline-delimited JSON requests on stdin:

    {"id": "<req-id>", "query": "...", "max_results": 30}

and reads newline-delimited JSON responses on stdout:

    {"id": "<req-id>", "ok": true, "result": {...}}
    {"id": "<req-id>", "ok": false, "error": "..."}

Requests are handled on a small thread pool so concurrent searches (ddgs is
network/IO bound) don't block one another. Stdout writes are serialized with a
lock so response lines never interleave.
"""

import sys
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from ddgs import DDGS

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] ddg_worker: %(message)s',
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

_write_lock = threading.Lock()


def _emit(payload):
    line = json.dumps(payload)
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# Each sub-search is an independent network call. NOTE: these run SEQUENTIALLY on
# purpose — DuckDuckGo rate-limits concurrent requests from one IP, so firing them
# in parallel trips backoff/retries and is dramatically SLOWER (observed via
# metrics.jsonl: ~16s sequential vs 60s+ timeout parallel). We instead cut latency
# by doing fewer calls (2 filetype dorks instead of 4).
def _text(query, max_results):
    out = []
    try:
        for r in DDGS().text(query, max_results=max_results):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "content": r.get("body", ""),
                "engine": "duckduckgo",
                "publishedDate": None,
            })
    except Exception as e:
        logger.warning(f"Web search failed: {e}")
    return out


def _images(query, max_results):
    out = []
    try:
        for r in DDGS().images(query, max_results=max_results):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "image": r.get("image", ""),
                "thumbnail": r.get("thumbnail", ""),
                "source": r.get("source", ""),
                "engine": "duckduckgo-images",
            })
    except Exception as e:
        logger.warning(f"Image search failed: {e}")
    return out


def _videos(query, max_results):
    out = []
    try:
        for r in DDGS().videos(query, max_results=max_results):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("content", ""),
                "description": r.get("description", ""),
                "duration": r.get("duration", ""),
                "publisher": r.get("publisher", ""),
                "publishedDate": r.get("published", None),
                "thumbnail": r.get("images", {}).get("large", "") if isinstance(r.get("images"), dict) else "",
                "engine": "duckduckgo-videos",
            })
    except Exception as e:
        logger.warning(f"Video search failed: {e}")
    return out


def _news(query, max_results):
    out = []
    try:
        for r in DDGS().news(query, max_results=max_results):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("body", ""),
                "source": r.get("source", ""),
                "image": r.get("image", ""),
                "publishedDate": r.get("date", None),
                "engine": "duckduckgo-news",
            })
    except Exception as e:
        logger.warning(f"News search failed: {e}")
    return out


def _books(query):
    out = []
    try:
        for r in DDGS().books(query, max_results=10):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": f"{r.get('author', '')} — {r.get('publisher', '')}",
                "thumbnail": r.get("thumbnail", ""),
                "engine": "duckduckgo-books",
            })
    except Exception as e:
        logger.warning(f"Books search failed: {e}")
    return out


def _dork(query, filetype):
    out = []
    try:
        for r in DDGS().text(f"{query} filetype:{filetype}", max_results=5):
            out.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "content": r.get("body", ""),
                "filetype": filetype,
                "engine": "duckduckgo-dorks",
            })
    except Exception as e:
        logger.warning(f"Document discovery failed for {filetype}: {e}")
    return out


def run_search(query, max_results):
    output = {
        "web": [],
        "images": [],
        "videos": [],
        "news": [],
        "documents": [],
        "books": [],
        "nsfw": [],
    }

    # NOTE: images/nsfw are sourced from SearXNG, not DuckDuckGo — DDG's image
    # endpoint (i.js) is reliably 403-blocked. Videos use a different endpoint and
    # still work, so they stay here.
    output["web"] = _text(query, max_results)
    output["news"] = _news(query, max_results)
    output["videos"] = _videos(query, max_results)
    output["books"] = _books(query)
    for filetype in ("pdf", "docx"):
        output["documents"].extend(_dork(query, filetype))

    return output


def handle(req, executor):
    req_id = req.get("id")
    query = req.get("query", "")
    max_results = int(req.get("max_results", 30))

    def done(future):
        try:
            _emit({"id": req_id, "ok": True, "result": future.result()})
        except Exception as e:
            _emit({"id": req_id, "ok": False, "error": str(e)})

    future = executor.submit(run_search, query, max_results)
    future.add_done_callback(done)


def main():
    logger.info("ddg_worker ready")
    with ThreadPoolExecutor(max_workers=4) as executor:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception as e:
                _emit({"id": None, "ok": False, "error": f"bad request: {e}"})
                continue
            handle(req, executor)


if __name__ == "__main__":
    main()

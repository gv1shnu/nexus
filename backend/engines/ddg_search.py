import sys
import json
import logging
from ddgs import DDGS

# Setup logging to output to stderr so it doesn't corrupt the JSON payload on stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] ddgs: %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

query = sys.argv[1]
max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 500

output = {
    "web": [],
    "images": [],
    "videos": [],
    "news": [],
    "documents": [],
    "books": []
}

ddgs = DDGS()

# 1. Web search
try:
    for r in ddgs.text(query, max_results=max_results):
        output["web"].append({
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "content": r.get("body", ""),
            "engine": "duckduckgo",
            "publishedDate": None
        })
except Exception as e:
    logger.warning(f"Web search failed: {e}")

# 2. Images
try:
    for r in ddgs.images(query, max_results=500):
        output["images"].append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "image": r.get("image", ""),
            "thumbnail": r.get("thumbnail", ""),
            "source": r.get("source", ""),
            "engine": "duckduckgo-images"
        })
except Exception as e:
    logger.warning(f"Image search failed: {e}")

# 3. Videos
try:
    for r in ddgs.videos(query, max_results=500):
        output["videos"].append({
            "title": r.get("title", ""),
            "url": r.get("content", ""),
            "description": r.get("description", ""),
            "duration": r.get("duration", ""),
            "publisher": r.get("publisher", ""),
            "publishedDate": r.get("published", None),
            "thumbnail": r.get("images", {}).get("large", "") if isinstance(r.get("images"), dict) else "",
            "engine": "duckduckgo-videos"
        })
except Exception as e:
    logger.warning(f"Video search failed: {e}")

# 4. News
try:
    for r in ddgs.news(query, max_results=500):
        output["news"].append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": r.get("body", ""),
            "source": r.get("source", ""),
            "image": r.get("image", ""),
            "publishedDate": r.get("date", None),
            "engine": "duckduckgo-news"
        })
except Exception as e:
    logger.warning(f"News search failed: {e}")

# 5. Books
try:
    for r in ddgs.books(query, max_results=10):
        output["books"].append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": f"{r.get('author', '')} — {r.get('publisher', '')}",
            "thumbnail": r.get("thumbnail", ""),
            "engine": "duckduckgo-books"
        })
except Exception as e:
    logger.warning(f"Books search failed: {e}")

# 6. Document discovery via Google dorks
for filetype in ["pdf", "docx", "pptx", "xlsx"]:
    try:
        for r in ddgs.text(f"{query} filetype:{filetype}", max_results=5):
            output["documents"].append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "content": r.get("body", ""),
                "filetype": filetype,
                "engine": "duckduckgo-dorks"
            })
    except Exception as e:
        logger.warning(f"Document discovery failed for {filetype}: {e}")

print(json.dumps(output))

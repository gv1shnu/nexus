# SearXNG for Render — the stock image with Nexus's config baked in (Render can't
# mount host volumes the way docker-compose does). Build context is this folder.
FROM searxng/searxng:latest

# settings.yml enables the JSON API (search.formats: json) that Nexus queries.
# The official entrypoint replaces the `ultrasecretkey` placeholder with the
# SEARXNG_SECRET env value at container start.
COPY settings.yml /etc/searxng/settings.yml

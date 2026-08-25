# Nexus backend + static frontend in one image (Node runtime + Python worker).
# Used by the `nexus` service in render.yaml, and runnable locally with:
#   docker build -t nexus . && docker run -p 8000:8000 nexus
FROM node:20-slim

WORKDIR /app

# Python 3 for the ddgs worker (engines/ddg_worker.py) and date extraction.
# ca-certificates is needed for the engines' outbound HTTPS calls.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps into a project venv at /app/venv — util/python.js auto-detects it,
# and a venv sidesteps Debian's PEP 668 "externally managed environment" block.
COPY requirements.txt ./
RUN python3 -m venv venv \
    && ./venv/bin/pip install --no-cache-dir --upgrade pip \
    && ./venv/bin/pip install --no-cache-dir -r requirements.txt

# Node deps (production only — jest/supertest are devDependencies).
COPY package.json ./
RUN npm install --omit=dev

# App source (backend + frontend).
COPY . .

ENV NODE_ENV=production
# Render injects PORT; server.js reads process.env.PORT and falls back to 8000.
EXPOSE 8000
CMD ["node", "backend/server.js"]

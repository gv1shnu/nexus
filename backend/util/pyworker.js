const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { resolvePython } = require('./python');

// Long-lived Python worker for ddgs searches. Spawned lazily on first use and
// respawned automatically if it dies. Requests are correlated by id so a single
// worker can service many concurrent searches.
const WORKER_SCRIPT = path.join(__dirname, '..', 'engines', 'ddg_worker.py');
const REQUEST_TIMEOUT = 60000;

let child = null;
let pending = new Map(); // id -> { resolve, reject, timer }

function startWorker() {
    const python = resolvePython();
    child = spawn(python, [WORKER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', (err) => failAll(`worker spawn error: ${err.message}`));
    child.on('exit', (code) => {
        const c = child;
        child = null;
        failAll(`worker exited (code ${code})`);
        // Keep the reference clear so the next request respawns.
        if (c) c.removeAllListeners();
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        line = line.trim();
        if (!line) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            return; // ignore non-JSON (shouldn't happen; logs go to stderr)
        }
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error || 'worker error'));
    });

    // Surface worker logs without keeping the event loop alive.
    child.stderr.on('data', (d) => {
        if (process.env.NEXUS_DEBUG) process.stderr.write(d);
    });

    // Don't let the worker keep the Node process (or Jest) alive on its own.
    child.unref();
    child.stdout.unref();
    child.stderr.unref();
    if (child.stdin) child.stdin.unref();
}

function failAll(reason) {
    for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
    }
    pending.clear();
}

function search(query, maxResults = 30) {
    return new Promise((resolve, reject) => {
        if (!child) {
            try {
                startWorker();
            } catch (err) {
                return reject(new Error(`failed to start python worker: ${err.message}`));
            }
        }
        if (!child || !child.stdin.writable) {
            return reject(new Error('python worker unavailable'));
        }

        const id = randomUUID();
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('python worker timeout'));
        }, REQUEST_TIMEOUT);

        pending.set(id, { resolve, reject, timer });

        const payload = JSON.stringify({ id, query, max_results: maxResults }) + '\n';
        child.stdin.write(payload, (err) => {
            if (err) {
                pending.delete(id);
                clearTimeout(timer);
                reject(new Error(`worker write failed: ${err.message}`));
            }
        });
    });
}

function shutdown() {
    if (child) {
        child.kill();
        child = null;
    }
    failAll('worker shutdown');
}

module.exports = { search, shutdown };

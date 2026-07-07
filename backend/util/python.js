const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Resolve a usable Python interpreter across platforms.
// Preference order:
//   1. NEXUS_PYTHON env override
//   2. Project virtualenv (venv/bin/python[3] on POSIX, venv/Scripts/python.exe on Windows)
//   3. python3 / python found on PATH
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function existsExecutable(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function onPath(cmd) {
    try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

let cached = null;

function resolvePython() {
    if (cached) return cached;

    const candidates = [];

    if (process.env.NEXUS_PYTHON) candidates.push(process.env.NEXUS_PYTHON);

    // Virtualenv locations
    candidates.push(
        path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
        path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
        path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe'),
        path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
        path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
        path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
    );

    for (const c of candidates) {
        if (existsExecutable(c)) {
            cached = c;
            return cached;
        }
    }

    // Fall back to interpreters on PATH
    for (const cmd of ['python3', 'python']) {
        if (onPath(cmd)) {
            cached = cmd;
            return cached;
        }
    }

    // Last resort: return 'python3' so callers get a clear spawn error
    cached = 'python3';
    return cached;
}

module.exports = { resolvePython, PROJECT_ROOT };

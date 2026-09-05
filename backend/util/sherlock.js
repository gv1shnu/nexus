// Native port of Sherlock's username-detection engine.
//
// Uses Sherlock's own site database (util/sherlock_sites.json — ~480 sites, MIT,
// vendored verbatim from github.com/sherlock-project/sherlock, see
// SHERLOCK-LICENSE.txt) and reimplements its exact detection algorithm in Node so
// Nexus gets real Sherlock coverage without a Python dependency. This replaces the
// old ~15-site status-code-only guess.
//
// Detection per site's `errorType` (faithful to sherlock_project/sherlock.py):
//   • message      — GET the profile; the account EXISTS unless one of the site's
//                    `errorMsg` strings appears in the body.
//   • status_code  — HEAD the profile; a 2xx means it exists (unless the code is in
//                    the site's `errorCode`); 3xx/4xx/5xx means it doesn't.
//   • response_url — GET with redirects disabled; a 2xx on the original URL means
//                    it exists (a not-found redirects away).
// Plus `regexCheck` (skip usernames a site can't have), `urlProbe` (probe a
// different URL than the one shown), `request_method`/`request_payload`, custom
// headers, and Sherlock's WAF fingerprints (a challenge page is not a hit).
const path = require('path');
const axios = require('axios');

const SITES = require('./sherlock_sites.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Tunables (env-overridable) — 480 live HTTP checks need bounding. Each site is a
// DIFFERENT host, so high concurrency doesn't rate-limit any single one; it just
// lets every site launch quickly so the slow-timeout tail (not the queue) is what
// the deadline trims.
// ~70 completes all ~480 sites in ~10s; higher (120+) causes DNS/socket contention
// that makes real sites time out, lower drags past the deadline. Deadline is a
// safety net for the slow-timeout tail.
const CONCURRENCY = parseInt(process.env.SHERLOCK_CONCURRENCY) || 70;
const REQ_TIMEOUT = parseInt(process.env.SHERLOCK_TIMEOUT_MS) || 5000;   // per site
const DEADLINE_MS = parseInt(process.env.SHERLOCK_DEADLINE_MS) || 25000; // overall
// NSFW sites are excluded by default; set SHERLOCK_INCLUDE_NSFW=1 to include them.
const INCLUDE_NSFW = process.env.SHERLOCK_INCLUDE_NSFW === '1';

// Cloudflare / AWS WAF / PerimeterX challenge fingerprints — a match means the
// request was blocked, not that the account exists (Sherlock's WAFHitMsgs).
const WAF_FINGERPRINTS = [
    '.loading-spinner{visibility:hidden}body.no-js .challenge-running{display:none}',
    '<span id="challenge-error-text">',
    'AwsWafIntegration.forceRefreshToken',
    '{return l.onPageView}}),Object.defineProperty(r,"perimeterxIdentifiers",{enumerable:',
];

const interpolate = (s, username) => String(s).split('{}').join(username);

function interpolatePayload(payload, username) {
    if (payload == null) return payload;
    if (typeof payload === 'string') return interpolate(payload, username);
    if (Array.isArray(payload)) return payload.map(v => interpolatePayload(v, username));
    if (typeof payload === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(payload)) out[k] = interpolatePayload(v, username);
        return out;
    }
    return payload;
}

// Check one site. Returns a found-account object, or null (not found / unknown /
// blocked / errored). Faithful to Sherlock's per-site logic.
async function checkSite(name, info, username) {
    const errorType = Array.isArray(info.errorType) ? info.errorType : [info.errorType];
    if (errorType.some(t => !['message', 'status_code', 'response_url'].includes(t))) return null;

    const displayUrl = interpolate(info.url, username);
    const probeUrl = info.urlProbe ? interpolate(info.urlProbe, username) : displayUrl;

    // status_code detection can use a body-less HEAD; the others need the body.
    let method = info.request_method || (errorType.includes('status_code') ? 'HEAD' : 'GET');
    method = method.toLowerCase();
    const allowRedirects = !errorType.includes('response_url');

    let res;
    try {
        res = await axios({
            method,
            url: probeUrl,
            headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', ...(info.headers || {}) },
            data: info.request_payload ? interpolatePayload(info.request_payload, username) : undefined,
            timeout: REQ_TIMEOUT,
            maxRedirects: allowRedirects ? 5 : 0,
            responseType: 'text',
            transformResponse: r => r,           // keep raw body for message matching
            validateStatus: () => true,          // never throw on 3xx/4xx/5xx
        });
    } catch {
        return null; // timeout / DNS / connection reset → treat as unchecked
    }

    const body = typeof res.data === 'string' ? res.data : '';
    const code = res.status;

    // A WAF/challenge page is not a positive hit.
    if (body && WAF_FINGERPRINTS.some(fp => body.includes(fp))) return null;

    let status = 'unknown'; // 'claimed' = exists, 'available' = free

    if (errorType.includes('message')) {
        let errors = info.errorMsg;
        if (typeof errors === 'string') errors = [errors];
        const hit = (errors || []).some(e => body.includes(e));
        status = hit ? 'available' : 'claimed';
    }
    if (errorType.includes('status_code') && status !== 'available') {
        let errorCodes = info.errorCode;
        if (typeof errorCodes === 'number') errorCodes = [errorCodes];
        status = 'claimed';
        if (errorCodes && errorCodes.includes(code)) status = 'available';
        else if (code >= 300 || code < 200) status = 'available';
    }
    if (errorType.includes('response_url') && status !== 'available') {
        status = (code >= 200 && code < 300) ? 'claimed' : 'available';
    }

    if (status !== 'claimed') return null;
    return {
        title: `${name} — @${username}`,
        url: displayUrl,
        content: `Account found on ${name}.`,
        engine: 'sherlock',
        platform: name,
        publishedDate: null,
    };
}

// Run all applicable sites through a bounded concurrency pool with an overall
// deadline. Sites not finished by the deadline are simply left unchecked (they
// don't count as "not found"), so latency stays bounded regardless of slow hosts.
async function checkUsername(username) {
    const sites = Object.entries(SITES).filter(([, info]) => {
        if (!info || !info.errorType) return false;
        if (info.isNSFW && !INCLUDE_NSFW) return false;
        if (info.regexCheck) {
            try { if (!new RegExp(info.regexCheck).test(username)) return false; } catch { /* bad regex → keep */ }
        }
        return true;
    });

    const found = [];
    const deadline = Date.now() + DEADLINE_MS;
    let idx = 0;

    async function worker() {
        while (idx < sites.length && Date.now() < deadline) {
            const [name, info] = sites[idx++];
            const hit = await checkSite(name, info, username);
            if (hit) found.push(hit);
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));
    // Stable, readable ordering.
    found.sort((a, b) => a.platform.localeCompare(b.platform));
    return found;
}

module.exports = { checkUsername, checkSite, SITE_COUNT: Object.keys(SITES).length };

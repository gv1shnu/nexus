const dns = require('dns').promises;
const net = require('net');

// Guard against SSRF: only allow http(s) to public hosts. Resolves the hostname
// and rejects if any resolved address is private/loopback/link-local, which also
// blocks DNS-rebinding to internal ranges (e.g. cloud metadata at 169.254.169.254).

function isPrivateIPv4(ip) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // treat malformed as unsafe
    const [a, b] = p;
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // loopback
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 169 && b === 254) return true;           // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                         // multicast / reserved
    return false;
}

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;       // loopback / unspecified
    if (lower.startsWith('fe80')) return true;                // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('::ffff:')) {                        // IPv4-mapped
        return isPrivateIPv4(lower.split(':').pop());
    }
    return false;
}

function isPrivateAddress(ip) {
    const type = net.isIP(ip);
    if (type === 4) return isPrivateIPv4(ip);
    if (type === 6) return isPrivateIPv6(ip);
    return true; // not a valid IP → unsafe
}

// Returns { ok: true } or { ok: false, reason }.
async function assertPublicUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, reason: 'invalid url' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'unsupported scheme' };
    }

    const host = parsed.hostname;

    // Literal IP host → check directly.
    if (net.isIP(host)) {
        return isPrivateAddress(host)
            ? { ok: false, reason: 'private address blocked' }
            : { ok: true };
    }

    // Hostname → resolve and verify every returned address is public.
    let addrs;
    try {
        addrs = await dns.lookup(host, { all: true });
    } catch {
        return { ok: false, reason: 'dns resolution failed' };
    }
    if (!addrs.length) return { ok: false, reason: 'no dns records' };
    for (const { address } of addrs) {
        if (isPrivateAddress(address)) {
            return { ok: false, reason: 'resolves to private address' };
        }
    }
    return { ok: true };
}

module.exports = { assertPublicUrl, isPrivateAddress };

const axios = require('axios');
const { checkUsername } = require('../util/sherlock');

// OSINT engine. Unlike keyword search, these are ENTITY lookups, so they only run
// when the query looks like a single entity (username / domain / IP), not a phrase.
//   • username  → real Sherlock: ~480-site presence check with per-site detection
//                 rules (util/sherlock.js + the vendored Sherlock site database)
//   • domain    → theHarvester-style subdomain discovery via certificate transparency (crt.sh)
//   • IP/host   → Shodan host lookup (requires SHODAN_API_KEY)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const looksLikeIP = q => /^(\d{1,3}\.){3}\d{1,3}$/.test(q);
const looksLikeDomain = q => /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(q) && /\.[a-z]{2,}$/i.test(q);
const looksLikeUsername = q => /^[a-zA-Z0-9_.-]{2,30}$/.test(q);

async function subdomainLookup(domain) {
    // Certificate transparency logs → subdomains (theHarvester's crt.sh source).
    try {
        const res = await axios.get('https://crt.sh/', {
            params: { q: `%.${domain}`, output: 'json' },
            timeout: 15000,
            headers: { 'User-Agent': UA }
        });
        const subs = new Set();
        for (const row of res.data || []) {
            for (const name of String(row.name_value || '').split('\n')) {
                const s = name.trim().toLowerCase();
                if (s && !s.startsWith('*') && s.endsWith(domain)) subs.add(s);
            }
        }
        return [...subs].slice(0, 60).map(sub => ({
            title: sub,
            url: `https://${sub}`,
            content: `Subdomain of ${domain} (certificate transparency).`,
            engine: 'theharvester',
            platform: 'crt.sh',
            publishedDate: null
        }));
    } catch {
        return [];
    }
}

async function shodanLookup(ip) {
    const key = process.env.SHODAN_API_KEY;
    if (!key) return [];
    try {
        const res = await axios.get(`https://api.shodan.io/shodan/host/${ip}`, {
            params: { key },
            timeout: 15000
        });
        const d = res.data || {};
        const ports = (d.ports || []).join(', ');
        return [{
            title: `${ip} — ${d.org || d.isp || 'host'}`,
            url: `https://www.shodan.io/host/${ip}`,
            content: `Open ports: ${ports || 'none'}. ${d.os ? 'OS: ' + d.os + '. ' : ''}${(d.hostnames || []).join(', ')}`,
            engine: 'shodan',
            platform: 'Shodan',
            ports: d.ports || [],
            publishedDate: null
        }];
    } catch {
        return [];
    }
}

async function search(query) {
    const q = (query || '').trim();
    if (!q || /\s/.test(q)) return { osint: [] }; // phrases aren't entities

    let osint = [];
    if (looksLikeIP(q)) {
        osint = await shodanLookup(q);
    } else if (looksLikeDomain(q)) {
        osint = await subdomainLookup(q);
    } else if (looksLikeUsername(q)) {
        osint = await checkUsername(q);
    }

    return { osint };
}

module.exports = { search };

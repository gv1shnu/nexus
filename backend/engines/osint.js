const axios = require('axios');

// OSINT engine. Unlike keyword search, these are ENTITY lookups, so they only run
// when the query looks like a single entity (username / domain / IP), not a phrase.
//   • username  → Sherlock-style presence check across platforms
//   • domain    → theHarvester-style subdomain discovery via certificate transparency (crt.sh)
//   • IP/host   → Shodan host lookup (requires SHODAN_API_KEY)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Sites where a 404 reliably means "no such user". (Soft-404 sites are omitted to
// keep false positives low — a lightweight stand-in for the full Sherlock list.)
const USERNAME_SITES = [
    { name: 'GitHub', url: u => `https://github.com/${u}` },
    { name: 'GitLab', url: u => `https://gitlab.com/${u}` },
    { name: 'Reddit', url: u => `https://www.reddit.com/user/${u}/about.json` },
    { name: 'Instagram', url: u => `https://www.instagram.com/${u}/` },
    { name: 'Twitch', url: u => `https://m.twitch.tv/${u}` },
    { name: 'Telegram', url: u => `https://t.me/${u}` },
    { name: 'Dev.to', url: u => `https://dev.to/${u}` },
    { name: 'Medium', url: u => `https://medium.com/@${u}` },
    { name: 'Hacker News', url: u => `https://news.ycombinator.com/user?id=${u}` },
    { name: 'Keybase', url: u => `https://keybase.io/${u}` },
    { name: 'PyPI', url: u => `https://pypi.org/user/${u}/` },
    { name: 'Docker Hub', url: u => `https://hub.docker.com/u/${u}` },
    { name: 'Steam', url: u => `https://steamcommunity.com/id/${u}` },
    { name: 'Pastebin', url: u => `https://pastebin.com/u/${u}` },
    { name: 'Replit', url: u => `https://replit.com/@${u}` },
];

const looksLikeIP = q => /^(\d{1,3}\.){3}\d{1,3}$/.test(q);
const looksLikeDomain = q => /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(q) && /\.[a-z]{2,}$/i.test(q);
const looksLikeUsername = q => /^[a-zA-Z0-9_.-]{2,30}$/.test(q);

async function checkSite(site, username) {
    const url = site.url(username);
    try {
        const res = await axios.get(url, {
            timeout: 8000,
            maxRedirects: 2,
            validateStatus: () => true,
            headers: { 'User-Agent': UA }
        });
        if (res.status >= 200 && res.status < 300) {
            return {
                title: `${site.name} — @${username}`,
                url,
                content: `Account found on ${site.name}.`,
                engine: 'sherlock',
                platform: site.name,
                publishedDate: null
            };
        }
    } catch { /* network error → treat as not found */ }
    return null;
}

async function usernameLookup(username) {
    const checks = await Promise.all(USERNAME_SITES.map(s => checkSite(s, username)));
    return checks.filter(Boolean);
}

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
        osint = await usernameLookup(q);
    }

    return { osint };
}

module.exports = { search };

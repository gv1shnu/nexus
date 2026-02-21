const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function search(query) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1366,768'
        ]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Handle Google consent page
    const consentBtn = await page.$('button[id="L2AGLb"]');
    if (consentBtn) {
        await consentBtn.click();
        await delay(2000);
    }

    await delay(1000 + Math.random() * 2000);

    await page.waitForSelector('h3', { timeout: 10000 }).catch(() => { });

    const results = await page.$$eval('#search .g', elements =>
        elements.map(el => {
            const titleEl = el.querySelector('h3');
            const linkEl = el.querySelector('a');
            const snippetEl = el.querySelector('[data-sncf], .VwiC3b, [style="-webkit-line-clamp:2"]');
            return {
                title: titleEl?.textContent?.trim() || '',
                url: linkEl?.href || '',
                content: snippetEl?.textContent?.trim() || '',
                engine: 'google',
                publishedDate: null
            };
        }).filter(r => r.title && r.url)
    );

    await browser.close();
    return results;
}

// Allow standalone CLI usage
if (require.main === module) {
    const q = process.argv[2];
    if (!q) {
        console.error('Usage: node gg.js "your search query"');
        process.exit(1);
    }
    search(q).then(results => {
        if (results.length === 0) {
            console.log('No results — Google may be showing a CAPTCHA.');
        } else {
            console.log(`Found ${results.length} result(s):\n`);
            results.forEach((r, i) => console.log(`  ${i + 1}. ${r.title}`));
        }
    }).catch(err => console.error(err));
}

module.exports = { search };

const ddg = require('./engines/ddg');
const wikipedia = require('./engines/wikipedia');
const stackexchange = require('./engines/stackexchange');
const reddit = require('./engines/reddit');
const arxiv = require('./engines/arxiv');
const searxng = require('./engines/searxng');

const QUERY = 'javascript';

describe('Engine Integration Tests', () => {

    test('DuckDuckGo (ddg) returns results', async () => {
        const data = await ddg.search(QUERY);
        const webCount = (data.web || []).length;
        const imgCount = (data.images || []).length;
        const vidCount = (data.videos || []).length;
        const newsCount = (data.news || []).length;
        const docCount = (data.documents || []).length;
        const total = webCount + imgCount + vidCount + newsCount + docCount;

        console.log(`  DDG: ${webCount} web, ${imgCount} images, ${vidCount} videos, ${newsCount} news, ${docCount} docs = ${total} total`);

        expect(total).toBeGreaterThan(0);
    }, 90000);

    test('Wikipedia returns results', async () => {
        const data = await wikipedia.search(QUERY);
        const count = (data.reference || []).length;

        console.log(`  Wikipedia: ${count} reference results`);

        expect(count).toBeGreaterThan(0);
    }, 15000);

    test('StackExchange returns results', async () => {
        const data = await stackexchange.search(QUERY);
        const count = (data.code || []).length;

        console.log(`  StackExchange: ${count} code results`);

        expect(count).toBeGreaterThan(0);
    }, 15000);

    test('Reddit returns results', async () => {
        const data = await reddit.search(QUERY);
        const count = (data.community || []).length;

        console.log(`  Reddit: ${count} community results`);

        expect(count).toBeGreaterThan(0);
    }, 15000);

    test('arXiv returns results', async () => {
        const data = await arxiv.search(QUERY);
        const count = (data.academic || []).length;

        console.log(`  arXiv: ${count} academic results`);

        expect(count).toBeGreaterThan(0);
    }, 20000);

    test('SearXNG returns results', async () => {
        const data = await searxng.search(QUERY);
        const count = (data.web || []).length;

        console.log(`  SearXNG: ${count} web results`);

        expect(count).toBeGreaterThan(0);
    }, 25000);

});

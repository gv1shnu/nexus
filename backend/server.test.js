const request = require('supertest');
const app = require('./server');

// Mock all engine modules
jest.mock('./engines/ddg', () => ({
    search: jest.fn().mockResolvedValue({
        web: [
            { title: 'DDG Result 1', url: 'https://ddg1.com', content: 'test body 1', engine: 'duckduckgo', publishedDate: null },
            { title: 'DDG Result 2', url: 'https://ddg2.com', content: 'test body 2', engine: 'duckduckgo', publishedDate: null }
        ],
        images: [], videos: [], news: [], documents: [], books: []
    })
}));

jest.mock('./engines/searxng', () => ({
    search: jest.fn().mockResolvedValue({ web: [] })
}));

jest.mock('./engines/wikipedia', () => ({
    search: jest.fn().mockResolvedValue({ academic: [{ title: 'Wiki Result', url: 'https://en.wikipedia.org/wiki/Test', content: 'test', engine: 'wikipedia' }] })
}));

jest.mock('./engines/stackexchange', () => ({
    search: jest.fn().mockResolvedValue({ code: [] })
}));

jest.mock('./engines/reddit', () => ({
    search: jest.fn().mockResolvedValue({ community: [] })
}));

jest.mock('./engines/arxiv', () => ({
    search: jest.fn().mockResolvedValue({ academic: [] })
}));

jest.mock('./engines/osint', () => ({
    search: jest.fn().mockResolvedValue({ osint: [] })
}));



describe('Nexus Backend API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 400 when missing query parameter', async () => {
        const res = await request(app).get('/api/search');
        expect(res.statusCode).toEqual(400);
        expect(res.body.error).toBe('Missing query parameter');
    });

    it('should return aggregated results from all engines', async () => {
        const res = await request(app).get('/api/search?q=test');
        expect(res.statusCode).toEqual(200);
        expect(res.body.query).toBe('test');
        expect(res.body.web.cards.length).toBe(2);
        expect(res.body.web.cards[0].title).toBe('DDG Result 1');
        expect(res.body.academic.length).toBe(1);
        expect(res.body.academic[0].engine).toBe('wikipedia');
    });

    it('should successfully log errors via /api/log-error', async () => {
        const res = await request(app)
            .post('/api/log-error')
            .send({ message: 'Test error', userAgent: 'Jest' });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
    });
});

import http, { IncomingMessage, ServerResponse } from 'http';
import { handleSolver } from './routes/solver';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// CORS: allow the production site and localhost for development
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://www.satisfactorytools.com')
    .split(',')
    .map(o => o.trim());

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function applyCORSHeaders(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers['origin'];
    if (!origin) {
        // No Origin header — allow (e.g. curl, server-to-server)
        return true;
    }
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return true;
    }
    return false;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1_048_576) {
                reject(new Error('Request body too large'));
            } else {
                chunks.push(chunk);
            }
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Preflight
    if (method === 'OPTIONS') {
        applyCORSHeaders(req, res);
        res.writeHead(204);
        res.end();
        return;
    }

    if (!applyCORSHeaders(req, res)) {
        sendJSON(res, 403, { error: 'Forbidden' });
        return;
    }

    // GET /health
    if (method === 'GET' && url === '/health') {
        sendJSON(res, 200, { status: 'ok' });
        return;
    }

    // POST /v2/solver
    if (method === 'POST' && url === '/v2/solver') {
        let bodyText: string;
        try {
            bodyText = await readBody(req);
        } catch {
            sendJSON(res, 413, { error: 'Request body too large' });
            return;
        }

        let body: unknown;
        try {
            body = JSON.parse(bodyText);
        } catch {
            sendJSON(res, 400, { error: 'Invalid JSON' });
            return;
        }

        handleSolver(body, res);
        return;
    }

    sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
    console.log(`Satisfactory Tools API server listening on port ${PORT}`);
});

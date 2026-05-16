import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import { IShareRequest } from '../types';

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'shares.db');

// Open (or create) the SQLite database
const db = new Database(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
`);

// Pre-compiled statements
const insertShare = db.prepare(
    'INSERT INTO shares (id, version, data, created_at) VALUES (?, ?, ?, ?)',
);
const selectShare = db.prepare<[string]>(
    'SELECT version, data FROM shares WHERE id = ?',
);

const router = Router();

/**
 * POST /v2/share/
 * Query param: version (e.g. "1.0" or "0.8")
 *
 * Body: IShareRequest (JSON)
 * Response: { link: string }
 */
router.post('/', (req: Request, res: Response): void => {
    const version = (req.query['version'] as string) ?? '1.0';
    const body = req.body as IShareRequest;

    if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid request body' });
        return;
    }

    const id = randomUUID();
    const now = Date.now();

    try {
        insertShare.run(id, version, JSON.stringify(body), now);
    } catch (err) {
        console.error('Share insert error:', err);
        res.status(500).json({ error: 'Failed to save share' });
        return;
    }

    const siteOrigin = process.env.SITE_ORIGIN ?? 'https://www.satisfactorytools.com';
    const link = `${siteOrigin}/${encodeURIComponent(version)}?share=${id}`;
    res.json({ link });
});

/**
 * GET /v2/share/:id
 *
 * Response: { data: IShareRequest }
 */
router.get('/:id', (req: Request, res: Response): void => {
    const id = String(req.params['id']);

    if (!id) {
        res.status(400).json({ error: 'Missing share id' });
        return;
    }

    let row: { version: string; data: string } | undefined;
    try {
        row = selectShare.get(id) as { version: string; data: string } | undefined;
    } catch (err) {
        console.error('Share lookup error:', err);
        res.status(500).json({ error: 'Failed to retrieve share' });
        return;
    }

    if (!row) {
        res.status(404).json({ error: 'Share not found' });
        return;
    }

    let data: IShareRequest;
    try {
        data = JSON.parse(row.data) as IShareRequest;
    } catch {
        res.status(500).json({ error: 'Corrupt share data' });
        return;
    }

    res.json({ data });
});

export default router;

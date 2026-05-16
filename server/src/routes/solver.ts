import { Router, Request, Response } from 'express';
import { solveProduction } from '../solver/ProductionSolver';
import { IJsonSchema, ISolverRequest } from '../types';

// Game data is loaded once at startup
import data08 from '../../../data/data.json';
import data10 from '../../../data/data1.0.json';
import data10Ficsmas from '../../../data/data1.0-ficsmas.json';

const router = Router();

function getDataForVersion(version: string): IJsonSchema | null {
    if (version === '0.8.0') return data08 as unknown as IJsonSchema;
    if (version === '1.0.0') return data10 as unknown as IJsonSchema;
    if (version === '1.0.0-ficsmas') return data10Ficsmas as unknown as IJsonSchema;
    return null;
}

/**
 * POST /v2/solver
 *
 * Body: ISolverRequest (JSON)
 * Response: { result: ISolverResponse }
 */
router.post('/', (req: Request, res: Response): void => {
    const body = req.body as ISolverRequest;

    if (!body || !body.gameVersion) {
        res.status(400).json({ error: 'Missing gameVersion in request body' });
        return;
    }

    const data = getDataForVersion(body.gameVersion);
    if (!data) {
        res.status(400).json({ error: `Unsupported gameVersion: ${body.gameVersion}` });
        return;
    }

    // Basic validation
    if (!Array.isArray(body.production) || body.production.length === 0) {
        res.status(400).json({ error: 'production must be a non-empty array' });
        return;
    }

    try {
        const result = solveProduction(body, data);
        res.json({ result });
    } catch (err) {
        console.error('Solver error:', err);
        res.status(500).json({ error: 'Internal solver error' });
    }
});

export default router;

import { ServerResponse } from 'http';
import { solveProduction } from '../solver/ProductionSolver';
import { IJsonSchema, ISolverRequest } from '../types';

// Game data is loaded once at startup
import data08 from '../../../data/data.json';
import data10 from '../../../data/data1.0.json';
import data10Ficsmas from '../../../data/data1.0-ficsmas.json';

function getDataForVersion(version: string): IJsonSchema | null {
    if (version === '0.8.0') return data08 as unknown as IJsonSchema;
    if (version === '1.0.0') return data10 as unknown as IJsonSchema;
    if (version === '1.0.0-ficsmas') return data10Ficsmas as unknown as IJsonSchema;
    return null;
}

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/**
 * Handles POST /v2/solver.
 *
 * @param body  Parsed JSON body from the incoming request.
 * @param res   The Node.js ServerResponse to write the result to.
 */
export function handleSolver(body: unknown, res: ServerResponse): void {
    const request = body as ISolverRequest;

    if (!request || !request.gameVersion) {
        sendJSON(res, 400, { error: 'Missing gameVersion in request body' });
        return;
    }

    const data = getDataForVersion(request.gameVersion);
    if (!data) {
        sendJSON(res, 400, { error: `Unsupported gameVersion: ${request.gameVersion}` });
        return;
    }

    if (!Array.isArray(request.production) || request.production.length === 0) {
        sendJSON(res, 400, { error: 'production must be a non-empty array' });
        return;
    }

    try {
        const result = solveProduction(request, data);
        sendJSON(res, 200, { result });
    } catch (err) {
        console.error('Solver error:', err);
        sendJSON(res, 500, { error: 'Internal solver error' });
    }
}

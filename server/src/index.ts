import express from 'express';
import cors from 'cors';
import compression from 'compression';
import solverRouter from './routes/solver';
import shareRouter from './routes/share';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// CORS: allow the production site and localhost for development
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://www.satisfactorytools.com')
    .split(',')
    .map(o => o.trim());

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. curl, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/v2/solver', solverRouter);
app.use('/v2/share', shareRouter);

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Satisfactory Tools API server listening on port ${PORT}`);
});

export default app;

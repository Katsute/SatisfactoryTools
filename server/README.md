# Satisfactory Tools – API Server

A Node.js / Express server that provides the back-end API for the
[Satisfactory Tools](https://www.satisfactorytools.com) site.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/v2/solver` | Solve a production plan |
| `POST` | `/v2/share/` | Create a shareable link |
| `GET`  | `/v2/share/:id` | Retrieve a shared production plan |

### POST `/v2/solver`

Accepts a JSON body matching `ISolverRequest` (see `src/types.ts`) and returns
the optimal machine allocations for the requested production targets.

```json
{
  "gameVersion": "1.0.0",
  "resourceMax": { "Desc_OreIron_C": 92100, "...": "..." },
  "resourceWeight": { "Desc_OreIron_C": 1, "...": "..." },
  "blockedResources": [],
  "blockedRecipes": [],
  "allowedAlternateRecipes": [],
  "sinkableResources": [],
  "production": [
    { "item": "Desc_IronPlate_C", "type": "perMinute", "amount": 60, "ratio": 100 }
  ],
  "input": []
}
```

Response:
```json
{
  "result": {
    "Recipe_IronPlate_C@100#Desc_ConstructorMk1_C": 3,
    "Recipe_IngotIron_C@100#Desc_SmelterMk1_C": 3,
    "Desc_OreIron_C#Mine": 90,
    "Desc_IronPlate_C#Product": 60
  }
}
```

Supported `gameVersion` values: `0.8.0`, `1.0.0`, `1.0.0-ficsmas`.

Production `type` values:
- `"perMinute"` – produce exactly `amount` items per minute.
- `"max"` – maximise production (respecting resource limits and the proportions
  expressed by `amount * ratio / 100` across multiple maximise targets).

Response key format:
- `<recipeClass>@100#<machineClass>` – number of machines running the recipe
- `<itemClass>#Mine` – raw resource extracted (items/min)
- `<itemClass>#Product` – requested product produced (items/min)
- `<itemClass>#Byproduct` – unrequested surplus item (items/min)
- `<itemClass>#Sink` – item fed to AWESOME Sink (items/min)
- `<itemClass>#Input` – user-supplied input used (items/min)

### POST `/v2/share/?version=<version>`

Saves the request body (an `IShareRequest`) and returns a shareable URL.

```json
{ "link": "https://www.satisfactorytools.com/1.0?share=<uuid>" }
```

### GET `/v2/share/:id`

Retrieves a previously saved plan.

```json
{ "data": { "metadata": { ... }, "request": { ... } } }
```

## Setup

```bash
npm install
npm run build
npm start
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | TCP port to listen on |
| `ALLOWED_ORIGINS` | `https://www.satisfactorytools.com` | Comma-separated list of allowed CORS origins (use `*` for any) |
| `SITE_ORIGIN` | `https://www.satisfactorytools.com` | Base URL used when generating share links |
| `DB_PATH` | `<server_root>/shares.db` | Path to the SQLite database file for shares |

### Development

```bash
npm run dev   # runs ts-node directly (no build step)
```

## Architecture

The production solver uses **linear programming** (via
[`javascript-lp-solver`](https://github.com/JWally/jsLPSolver)) to find the
optimal set of recipes and machine counts.

- **Phase 1** (only when `type: "max"` items are present): maximise `lambda`,
  the scaling factor for all maximise targets.
- **Phase 2**: minimise weighted raw-resource consumption while keeping
  `lambda` at its phase-1 value.

Share data is persisted in a **SQLite** database using
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

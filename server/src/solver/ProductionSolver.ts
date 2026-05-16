/**
 * Production solver using linear programming.
 *
 * Given a production request, the solver finds the optimal set of recipes and
 * machine counts to satisfy the targets while minimising weighted raw-resource
 * consumption.
 *
 * The LP model is built with the `javascript-lp-solver` library.
 *
 * Response key conventions (matching the client-side parser in
 * ProductionResultFactory.ts):
 *   `<recipeClass>@100#<machineClass>`  – machine count for the recipe
 *   `<itemClass>#Mine`                  – raw resource extracted (items/min)
 *   `<itemClass>#Product`               – requested item produced (items/min)
 *   `<itemClass>#Byproduct`             – unrequested surplus item (items/min)
 *   `<itemClass>#Sink`                  – item fed to AWESOME Sink (items/min)
 *   `<itemClass>#Input`                 – user-supplied input used (items/min)
 */

import { IItemAmountSchema, IJsonSchema, ISolverRequest, ISolverResponse, ISolverRequestItem, ISolverRequestInput } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Solver = require('javascript-lp-solver') as {
    Solve: (model: LPModel) => LPResult;
};

const PRODUCTION_TYPE_MAXIMIZE = 'max';
const EPSILON = 1e-8;

// Water has an effectively infinite limit in the game data (Number.MAX_SAFE_INTEGER).
// Cap it at a finite value so the LP stays numerically stable.
const MAX_RESOURCE_CAP = 1e12;

// Weight applied to lambda in the combined objective so that maximising
// production is always preferred over minimising resource usage.
const LAMBDA_OBJECTIVE_WEIGHT = 1e10;

// ── LP types ──────────────────────────────────────────────────────────────────

interface LPModel {
    optimize: string;
    opType: 'min' | 'max';
    constraints: Record<string, { min?: number; max?: number; equal?: number }>;
    variables: Record<string, Record<string, number>>;
}

interface LPResult {
    feasible: boolean;
    result: number;
    [key: string]: number | boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface RecipeInfo {
    className: string;
    machineClass: string;
    /** Items per minute per machine for each ingredient */
    ingredients: Array<{ item: string; rate: number }>;
    /** Items per minute per machine for each product */
    products: Array<{ item: string; rate: number }>;
}

/**
 * Returns the list of recipes that may be used for the given request.
 * - Includes base machine recipes not in `blockedRecipes`.
 * - Includes alternate recipes that are in `allowedAlternateRecipes`.
 * - Excludes hand/workshop/building recipes.
 * - Skips recipes whose machine cannot be found in the buildings table.
 */
function getAvailableRecipes(request: ISolverRequest, data: IJsonSchema): RecipeInfo[] {
    const result: RecipeInfo[] = [];

    for (const className in data.recipes) {
        const recipe = data.recipes[className];

        if (!recipe.inMachine || recipe.forBuilding) continue;
        if (recipe.alternate && !request.allowedAlternateRecipes.includes(className)) continue;
        if (!recipe.alternate && request.blockedRecipes.includes(className)) continue;

        // Find the first valid manufacturing building
        let machineClass: string | null = null;
        let manufacturingSpeed = 0;
        for (const produced of recipe.producedIn) {
            const building = data.buildings[produced];
            if (building && building.metadata.manufacturingSpeed && building.metadata.manufacturingSpeed > 0) {
                machineClass = produced;
                manufacturingSpeed = building.metadata.manufacturingSpeed;
                break;
            }
        }
        if (!machineClass) continue;

        const cyclesPerMinute = manufacturingSpeed * 60 / recipe.time;

        result.push({
            className,
            machineClass,
            ingredients: recipe.ingredients.map((ing: IItemAmountSchema) => ({
                item: ing.item,
                rate: ing.amount * cyclesPerMinute,
            })),
            products: recipe.products.map((prod: IItemAmountSchema) => ({
                item: prod.item,
                rate: prod.amount * cyclesPerMinute,
            })),
        });
    }

    return result;
}

/**
 * Adds `delta` to `record[key]`, creating the entry if it does not exist.
 */
function add(record: Record<string, number>, key: string, delta: number): void {
    record[key] = (record[key] ?? 0) + delta;
}

/**
 * Builds the LP model for the given phase.
 *
 * phase === 'maximize'  – Phase 1: maximise lambda (production ratio).
 * phase === 'minimize'  – Phase 2 / only phase: minimise weighted resource use.
 *
 * When `lambdaMin` is provided (phase === 'minimize' after a previous phase 1),
 * lambda is constrained to be at least `lambdaMin`.
 */
function buildModel(
    request: ISolverRequest,
    data: IJsonSchema,
    recipes: RecipeInfo[],
    phase: 'maximize' | 'minimize',
    lambdaMin: number,
): LPModel {
    const model: LPModel = {
        optimize: 'obj',
        opType: phase === 'maximize' ? 'max' : 'min',
        constraints: {},
        variables: {},
    };

    const hasMaximize = request.production.some(
        p => p.type === PRODUCTION_TYPE_MAXIMIZE && p.item && p.amount > 0,
    );

    // ── Raw-resource constraints ──────────────────────────────────────────────

    for (const resourceClass in data.resources) {
        if (request.blockedResources.includes(resourceClass)) {
            // Blocked: enforce zero consumption via max = 0
            model.constraints[`raw_${resourceClass}`] = { max: 0 };
        } else {
            const cap = Math.min(
                request.resourceMax[resourceClass] ?? 0,
                MAX_RESOURCE_CAP,
            );
            model.constraints[`raw_${resourceClass}`] = { max: cap };
        }
    }

    // ── Item-balance constraints ──────────────────────────────────────────────

    // Build a set of all items that appear in any available recipe
    const usedItems = new Set<string>();
    for (const r of recipes) {
        for (const ing of r.ingredients) usedItems.add(ing.item);
        for (const prod of r.products) usedItems.add(prod.item);
    }
    // Also add production-target items (they may not appear in any recipe if
    // they are raw resources, but we still need to handle them)
    for (const p of request.production) {
        if (p.item) usedItems.add(p.item);
    }

    for (const itemClass of usedItems) {
        if (itemClass in data.resources) continue; // Raw resources handled above

        // Find the target demand (PER_MINUTE)
        const target = request.production.find(
            p => p.item === itemClass && p.type !== PRODUCTION_TYPE_MAXIMIZE && p.amount > 0,
        );
        const demand = target ? target.amount : 0;
        model.constraints[`item_${itemClass}`] = { min: demand };
    }

    // For MAXIMIZE items: additional constraint  net_production_i >= lambda * T_i
    if (hasMaximize) {
        for (const p of request.production) {
            if (p.type !== PRODUCTION_TYPE_MAXIMIZE || !p.item || p.amount <= 0) continue;
            // T_i = amount * ratio / 100
            model.constraints[`maximize_${p.item}`] = { min: 0 };
        }
    }

    // ── User-input variables ──────────────────────────────────────────────────

    const userInputsByItem: Record<string, number> = {};
    for (const inp of request.input) {
        if (!inp.item || inp.amount <= 0) continue;
        userInputsByItem[inp.item] = (userInputsByItem[inp.item] ?? 0) + inp.amount;
    }

    for (const itemClass in userInputsByItem) {
        const varName = `y_${itemClass}`;
        const boundName = `input_bound_${itemClass}`;
        model.variables[varName] = {};
        model.constraints[boundName] = { max: userInputsByItem[itemClass] };
        model.variables[varName][boundName] = 1;

        if (itemClass in data.resources) {
            // Raw resource user-input: increases the available supply
            add(model.variables[varName], `raw_${itemClass}`, -1);
        } else {
            add(model.variables[varName], `item_${itemClass}`, 1);
            if (hasMaximize) {
                const target = request.production.find(
                    p => p.item === itemClass && p.type === PRODUCTION_TYPE_MAXIMIZE,
                );
                if (target) {
                    add(model.variables[varName], `maximize_${itemClass}`, 1);
                }
            }
        }
    }

    // ── Lambda variable (MAXIMIZE phase) ─────────────────────────────────────

    if (hasMaximize) {
        const lambdaVar: Record<string, number> = {};

        if (phase === 'maximize') {
            lambdaVar['obj'] = 1; // maximise lambda directly
        } else {
            lambdaVar['obj'] = 0; // neutral in the minimise objective
        }

        if (lambdaMin > 0) {
            model.constraints['lambda_min'] = { min: lambdaMin };
            lambdaVar['lambda_min'] = 1;
        }

        // Lambda contributes -T_i to each maximize constraint
        for (const p of request.production) {
            if (p.type !== PRODUCTION_TYPE_MAXIMIZE || !p.item || p.amount <= 0) continue;
            const Ti = p.amount * p.ratio / 100;
            if (Ti > 0) {
                lambdaVar[`maximize_${p.item}`] = -Ti;
            }
        }

        model.variables['lambda'] = lambdaVar;
    }

    // ── Recipe variables ──────────────────────────────────────────────────────

    for (const recipe of recipes) {
        const varName = `x_${recipe.className}`;
        const varCoeffs: Record<string, number> = {};

        // Objective: weighted raw-resource consumption (minimise in phase 2 / only phase)
        let resourceCost = 0;
        for (const ing of recipe.ingredients) {
            if (ing.item in data.resources) {
                const weight = request.resourceWeight[ing.item] ?? 1;
                resourceCost += weight * ing.rate;
            }
        }

        if (phase === 'maximize') {
            // In phase 1, the only objective is lambda; set a tiny resource
            // cost so the solver prefers cheaper solutions when lambda is tied.
            varCoeffs['obj'] = -resourceCost * 1e-10;
        } else {
            varCoeffs['obj'] = resourceCost;
        }

        // Raw resource consumption
        for (const ing of recipe.ingredients) {
            if (ing.item in data.resources) {
                add(varCoeffs, `raw_${ing.item}`, ing.rate);
            }
        }

        // Item-balance contributions
        for (const ing of recipe.ingredients) {
            if (!(ing.item in data.resources) && `item_${ing.item}` in model.constraints) {
                add(varCoeffs, `item_${ing.item}`, -ing.rate);
            }
        }
        for (const prod of recipe.products) {
            if (!(prod.item in data.resources) && `item_${prod.item}` in model.constraints) {
                add(varCoeffs, `item_${prod.item}`, prod.rate);
            }
            // MAXIMIZE constraints
            if (hasMaximize && `maximize_${prod.item}` in model.constraints) {
                add(varCoeffs, `maximize_${prod.item}`, prod.rate);
            }
        }
        // A recipe may also consume a MAXIMIZE-target item
        for (const ing of recipe.ingredients) {
            if (hasMaximize && `maximize_${ing.item}` in model.constraints) {
                add(varCoeffs, `maximize_${ing.item}`, -ing.rate);
            }
        }

        model.variables[varName] = varCoeffs;
    }

    return model;
}

/**
 * Converts the raw LP solution into the API response format expected by the
 * client-side `ProductionResultFactory`.
 */
function buildResponse(
    solution: LPResult,
    request: ISolverRequest,
    data: IJsonSchema,
    recipes: RecipeInfo[],
): ISolverResponse {
    const response: ISolverResponse = {};

    const targetItems = new Set(
        request.production
            .filter(p => p.item && p.amount > 0)
            .map(p => p.item as string),
    );

    // ── Recipe machine counts ─────────────────────────────────────────────────

    const itemNetProduction: Record<string, number> = {};

    for (const recipe of recipes) {
        const machines: number = (solution[`x_${recipe.className}`] as number) || 0;
        if (machines < EPSILON) continue;

        const key = `${recipe.className}@100#${recipe.machineClass}`;
        response[key] = machines;

        for (const prod of recipe.products) {
            add(itemNetProduction, prod.item, prod.rate * machines);
        }
        for (const ing of recipe.ingredients) {
            add(itemNetProduction, ing.item, -ing.rate * machines);
        }
    }

    // ── User inputs used ──────────────────────────────────────────────────────

    for (const inp of request.input) {
        if (!inp.item || inp.amount <= 0) continue;
        const used: number = (solution[`y_${inp.item}`] as number) || 0;
        if (used < EPSILON) continue;
        response[`${inp.item}#Input`] = used;
        add(itemNetProduction, inp.item, used);
    }

    // ── Raw resource extraction ───────────────────────────────────────────────

    for (const resourceClass in data.resources) {
        const consumed = -(itemNetProduction[resourceClass] ?? 0);
        // User-input offsets raw mining: clamp to >= 0
        const userInputUsed: number = (solution[`y_${resourceClass}`] as number) || 0;
        const mined = Math.max(0, consumed - userInputUsed);
        if (mined < EPSILON) continue;
        response[`${resourceClass}#Mine`] = mined;
    }

    // ── Product / byproduct / sink nodes ─────────────────────────────────────

    for (const itemClass in itemNetProduction) {
        if (itemClass in data.resources) continue; // already handled as #Mine

        const net = itemNetProduction[itemClass];
        if (net < EPSILON) continue;

        if (targetItems.has(itemClass)) {
            response[`${itemClass}#Product`] = net;
        } else if (request.sinkableResources.includes(itemClass)) {
            response[`${itemClass}#Sink`] = net;
        } else {
            response[`${itemClass}#Byproduct`] = net;
        }
    }

    return response;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Solves the production LP for the given request and game-data schema.
 * Returns an empty object if the problem is infeasible.
 */
export function solveProduction(request: ISolverRequest, data: IJsonSchema): ISolverResponse {
    const recipes = getAvailableRecipes(request, data);

    const hasMaximize = request.production.some(
        p => p.type === PRODUCTION_TYPE_MAXIMIZE && p.item && p.amount > 0,
    );

    let finalSolution: LPResult;

    if (hasMaximize) {
        // Phase 1 – maximise lambda
        const model1 = buildModel(request, data, recipes, 'maximize', 0);
        const result1 = Solver.Solve(model1) as LPResult;
        if (!result1.feasible) return {};

        const lambda = (result1['lambda'] as number) || 0;

        // Phase 2 – minimise resource usage, keeping lambda >= phase-1 value
        const model2 = buildModel(request, data, recipes, 'minimize', lambda);
        finalSolution = Solver.Solve(model2) as LPResult;
    } else {
        const model = buildModel(request, data, recipes, 'minimize', 0);
        finalSolution = Solver.Solve(model) as LPResult;
    }

    if (!finalSolution.feasible) return {};

    return buildResponse(finalSolution, request, data, recipes);
}

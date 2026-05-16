// Mirrors the TypeScript interfaces used by the client-side Angular app.

export interface IItemAmountSchema {
    item: string;
    amount: number;
}

export interface IRecipeSchema {
    slug: string;
    name: string;
    className: string;
    alternate: boolean;
    time: number;
    inHand: boolean;
    forBuilding: boolean;
    inWorkshop: boolean;
    inMachine: boolean;
    manualTimeMultiplier: number;
    ingredients: IItemAmountSchema[];
    products: IItemAmountSchema[];
    producedIn: string[];
    isVariablePower: boolean;
}

export interface IBuildingMetadataSchema {
    manufacturingSpeed?: number;
    powerConsumption?: number;
    powerConsumptionExponent?: number;
}

export interface IBuildingSchema {
    slug: string;
    name: string;
    className: string;
    categories: string[];
    metadata: IBuildingMetadataSchema;
}

export interface IItemSchema {
    slug: string;
    name: string;
    className: string;
    sinkPoints: number;
    liquid: boolean;
}

export interface IResourceSchema {
    item: string;
}

export interface IMinerSchema {
    className: string;
    allowedResources: string[];
    allowLiquids: boolean;
    allowSolids: boolean;
    itemsPerCycle: number;
    extractCycleTime: number;
}

export interface IGeneratorSchema {
    className: string;
}

export interface ISchematicSchema {
    className: string;
    name: string;
}

export interface IJsonSchema {
    items: Record<string, IItemSchema>;
    recipes: Record<string, IRecipeSchema>;
    schematics: Record<string, ISchematicSchema>;
    generators: Record<string, IGeneratorSchema>;
    resources: Record<string, IResourceSchema>;
    miners: Record<string, IMinerSchema>;
    buildings: Record<string, IBuildingSchema>;
}

// API request sent by the client to POST /v2/solver
export interface ISolverRequest {
    gameVersion: string;
    resourceMax: Record<string, number>;
    resourceWeight: Record<string, number>;
    blockedResources: string[];
    blockedRecipes: string[];
    allowedAlternateRecipes: string[];
    sinkableResources: string[];
    production: ISolverRequestItem[];
    input: ISolverRequestInput[];
}

export interface ISolverRequestItem {
    item: string | null;
    type: string;   // 'perMinute' | 'max'
    amount: number;
    ratio: number;
}

export interface ISolverRequestInput {
    item: string | null;
    amount: number;
}

// Response from POST /v2/solver
export type ISolverResponse = Record<string, number>;

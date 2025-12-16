import type { Feature, Polygon, GeoJsonProperties, FeatureCollection } from 'geojson';
import { booleanIntersects, bbox } from '@turf/turf';
import RBush from 'rbush';

// Grid configuration with decreasing cell sizes
export const GRID_LEVELS = [
    { min: 8, max: 11, size: 0.04 },
    { min: 11, max: 13, size: 0.02 },
    { min: 13, max: 15, size: 0.01 },
    { min: 15, max: 22, size: 0.005 }
];

// Define Index Item Interface for RBush
interface IndexItem {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    feature: Feature<any>;
}

// State management
let rootCellIdMap: Map<string, string> | null = null;
let cachedOrigin: [number, number] | null = null;
let spatialIndex: RBush<IndexItem> | null = null;

// Reusable objects to reduce GC pressure
const tempPolygon: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'Polygon',
        coordinates: [] // Coordinates will be injected
    }
};

/**
 * Configure the grid system with the data mask.
 * Builds a spatial index for efficient querying.
 */
export function configureGrid(mask: FeatureCollection, gridBBox: [number, number, number, number]) {
    rootCellIdMap = new Map();
    cachedOrigin = [gridBBox[0], gridBBox[3]];

    // 1. Initialize Spatial Index
    spatialIndex = new RBush<IndexItem>();
    const items: IndexItem[] = mask.features.map(f => {
        const [minX, minY, maxX, maxY] = bbox(f);
        return { minX, minY, maxX, maxY, feature: f };
    });
    spatialIndex.load(items);

    const rootSize = GRID_LEVELS[0].size;
    const origin = cachedOrigin;

    // Determine grid dimensions covering the bbox
    const gridWidth = Math.ceil((gridBBox[2] - gridBBox[0]) / rootSize);
    const gridHeight = Math.ceil((gridBBox[3] - gridBBox[1]) / rootSize);

    let nextIdIndex = 0;

    // Reuse geometry object for root cell checks
    const rootGeo: Polygon = {
        type: 'Polygon',
        coordinates: [[]]
    };

    // Iterate through all potential root cells in the bbox
    for (let row = 0; row < gridHeight; row++) {
        for (let col = 0; col < gridWidth; col++) {
            const x1 = origin[0] + col * rootSize;
            const x2 = origin[0] + (col + 1) * rootSize;
            const y1 = origin[1] - row * rootSize;
            const y2 = origin[1] - (row + 1) * rootSize;

            // Update reused geometry
            const coords = rootGeo.coordinates[0];
            coords[0] = [x1, y1];
            coords[1] = [x2, y1];
            coords[2] = [x2, y2];
            coords[3] = [x1, y2];
            coords[4] = [x1, y1]; // Close loop

            // Optimization: Query Index first (Broad Phase)
            const candidates = spatialIndex.search({ minX: x1, minY: y2, maxX: x2, maxY: y1 });

            if (candidates.length === 0) continue;

            // Precise Phase
            let intersects = false;
            for (const item of candidates) {
                if (booleanIntersects(rootGeo, item.feature)) {
                    intersects = true;
                    break;
                }
            }

            if (intersects) {
                const id = toBase26(nextIdIndex++);
                rootCellIdMap.set(`${col},${row}`, id);
            }
        }
    }
}

/**
 * Generates grid features based on the current viewport bounds and zoom level.
 */
export function generateGridFeatures(
    viewBounds: [number, number, number, number],
    zoom: number
): Feature<Polygon, GeoJsonProperties>[] {
    if (!rootCellIdMap || !cachedOrigin || !spatialIndex) return [];

    const level = GRID_LEVELS.find(l => zoom >= l.min && zoom < l.max);
    if (!level) return [];

    const [viewWest, viewSouth, viewEast, viewNorth] = viewBounds;
    const origin = cachedOrigin;
    const size = level.size;
    const rootSize = GRID_LEVELS[0].size;
    const epsilon = 1e-6;

    // Calculate grid indices
    const startCol = Math.floor((viewWest - origin[0]) / size);
    const endCol = Math.ceil((viewEast - origin[0]) / size);
    const startRow = Math.floor((origin[1] - viewNorth) / size);
    const endRow = Math.ceil((origin[1] - viewSouth) / size);

    const features: Feature<Polygon, GeoJsonProperties>[] = [];

    // Reusable coordinate array for current cell
    const cellCoords = [[
        [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]
    ]];

    // Update temp polygon struct once
    (tempPolygon.geometry as Polygon).coordinates = cellCoords;

    for (let col = startCol; col < endCol; col++) {
        for (let row = startRow; row < endRow; row++) {
            const x1 = origin[0] + col * size;
            const x2 = origin[0] + (col + 1) * size;
            const y1 = origin[1] - row * size;
            const y2 = origin[1] - (row + 1) * size;

            // Center point
            const cx = x1 + size / 2;
            const cy = y1 - size / 2;

            // Determine Root Cell Coordinates
            const rootCol = Math.floor((cx - origin[0] + epsilon) / rootSize);
            const rootRow = Math.floor((origin[1] - cy + epsilon) / rootSize);

            // Look up Root ID - O(1)
            const rootId = rootCellIdMap.get(`${rootCol},${rootRow}`);
            if (!rootId) continue;

            // Update reusable coordinates
            cellCoords[0][0][0] = x1; cellCoords[0][0][1] = y1;
            cellCoords[0][1][0] = x2; cellCoords[0][1][1] = y1;
            cellCoords[0][2][0] = x2; cellCoords[0][2][1] = y2;
            cellCoords[0][3][0] = x1; cellCoords[0][3][1] = y2;
            cellCoords[0][4][0] = x1; cellCoords[0][4][1] = y1;

            // Broad Phase Check: Query Index
            const candidates = spatialIndex.search({ minX: x1, minY: y2, maxX: x2, maxY: y1 });
            if (candidates.length === 0) continue;

            // Precise Phase Check
            let intersects = false;
            for (const item of candidates) {
                if (booleanIntersects(tempPolygon as Feature<Polygon>, item.feature)) {
                    intersects = true;
                    break;
                }
            }

            if (!intersects) continue;

            // Grid ID Generation Logic
            let id = rootId;
            let currentSize = rootSize;
            let depth = 0;

            // Optimization: Avoid while loop if not needed, but here we need it for sub-IDs
            while (currentSize > size * 1.01) {
                const half = currentSize / 2;
                const xBit = ((cx - origin[0]) % currentSize) >= (half - epsilon) ? 1 : 0;
                const yBit = ((origin[1] - cy) % currentSize) >= (half - epsilon) ? 1 : 0;

                id += (depth % 2 === 0)
                    ? (yBit * 2 + xBit).toString()
                    : ['A', 'B', 'C', 'D'][yBit * 2 + xBit];

                currentSize = half;
                depth++;
            }

            // Create new object only when pushing to result
            features.push({
                type: 'Feature',
                properties: { id, zoom: Math.round(zoom) },
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
                    ]
                }
            });
        }
    }

    return features;
}

// Convert index to Base 26 (A-Z, AA-ZZ)
export function toBase26(n: number): string {
    let s = "";
    while (n >= 0) {
        s = String.fromCharCode((n % 26) + 65) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}

import type { Feature, Polygon, GeoJsonProperties, FeatureCollection } from 'geojson';
import { booleanIntersects } from '@turf/turf';

// Grid configuration with decreasing cell sizes
export const GRID_LEVELS = [
    { min: 8, max: 11, size: 0.04 },
    { min: 11, max: 13, size: 0.02 },
    { min: 13, max: 15, size: 0.01 },
    { min: 15, max: 22, size: 0.005 }
];

// Cache for valid root cell IDs
let rootCellIdMap: Map<string, string> | null = null;
let cachedOrigin: [number, number] | null = null;

export function configureGrid(mask: FeatureCollection, gridBBox: [number, number, number, number]) {
    rootCellIdMap = new Map();
    cachedOrigin = [gridBBox[0], gridBBox[3]];

    const rootSize = GRID_LEVELS[0].size;
    const origin = cachedOrigin;

    // Determine grid dimensions covering the bbox
    const gridWidth = Math.ceil((gridBBox[2] - gridBBox[0]) / rootSize);
    const gridHeight = Math.ceil((gridBBox[3] - gridBBox[1]) / rootSize);

    let nextIdIndex = 0;

    // Iterate through all potential root cells in the bbox
    for (let row = 0; row < gridHeight; row++) {
        for (let col = 0; col < gridWidth; col++) {
            const x1 = origin[0] + col * rootSize;
            const x2 = origin[0] + (col + 1) * rootSize;
            const y1 = origin[1] - row * rootSize;
            const y2 = origin[1] - (row + 1) * rootSize;

            const geometry: Polygon = {
                type: 'Polygon',
                coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]
            };

            // Check intersection
            let intersects = false;
            for (const feature of mask.features) {
                if (booleanIntersects(geometry, feature)) {
                    intersects = true;
                    break;
                }
            }

            if (intersects) {
                // Assign sequential ID
                const id = toBase26(nextIdIndex++);
                rootCellIdMap.set(`${col},${row}`, id);
            }
        }
    }
}

/**
 * Generates grid features based on the current viewport bounds and zoom level.
 * @param viewBounds [west, south, east, north]
 * @param zoom Current zoom level
 * @param mask Optional FeatureCollection to limit grid cells (for sub-cells)
 */
export function generateGridFeatures(
    viewBounds: [number, number, number, number],
    zoom: number,
    mask?: FeatureCollection
): Feature<Polygon, GeoJsonProperties>[] {
    if (!rootCellIdMap || !cachedOrigin) return [];

    const level = GRID_LEVELS.find(l => zoom >= l.min && zoom < l.max);
    if (!level) return [];

    const [viewWest, viewSouth, viewEast, viewNorth] = viewBounds;
    const origin = cachedOrigin;

    // Snap grid to origin
    const size = level.size;

    // Calculate horizontal grid indices
    const startCol = Math.floor((viewWest - origin[0]) / size);
    const endCol = Math.ceil((viewEast - origin[0]) / size);

    // Calculate vertical grid indices
    const startRow = Math.floor((origin[1] - viewNorth) / size);
    const endRow = Math.ceil((origin[1] - viewSouth) / size);

    const features: Feature<Polygon, GeoJsonProperties>[] = [];

    // Dynamic grid parameters
    const rootSize = GRID_LEVELS[0].size;
    const epsilon = 0.000001;

    for (let col = startCol; col < endCol; col++) {
        for (let row = startRow; row < endRow; row++) {
            const x1 = origin[0] + col * size;
            const x2 = origin[0] + (col + 1) * size;
            const y1 = origin[1] - row * size;
            const y2 = origin[1] - (row + 1) * size;

            const geometry: Polygon = {
                type: 'Polygon',
                coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]
            };

            const cx = x1 + size / 2;
            const cy = y1 - size / 2;

            // Determine Root Cell Coordinates
            const rootCol = Math.floor((cx - origin[0] + epsilon) / rootSize);
            const rootRow = Math.floor((origin[1] - cy + epsilon) / rootSize);

            // Look up Root ID
            const rootId = rootCellIdMap.get(`${rootCol},${rootRow}`);

            // If root cell is not part of the valid grid, skip entirely
            if (!rootId) continue;

            let id = rootId;

            // Alternating subdivision IDs
            let currentSize = rootSize;
            let depth = 0;
            while (currentSize > level.size * 1.01) {
                const half = currentSize / 2;
                const xBit = ((cx - origin[0]) % currentSize) >= (half - epsilon) ? 1 : 0;
                const yBit = ((origin[1] - cy) % currentSize) >= (half - epsilon) ? 1 : 0;

                id += (depth % 2 === 0)
                    ? (yBit * 2 + xBit).toString()
                    : ['A', 'B', 'C', 'D'][yBit * 2 + xBit];

                currentSize = half;
                depth++;
            }

            // Final containment check for the sub-cell
            // (The root cell check ensures we are broadly in the area, but sub-cells near the edge might be out)
            if (mask) {
                let intersects = false;
                for (const maskFeature of mask.features) {
                    if (booleanIntersects(geometry, maskFeature)) {
                        intersects = true;
                        break;
                    }
                }
                if (!intersects) {
                    continue;
                }
            }

            features.push({
                type: 'Feature',
                properties: { id, zoom: Math.round(zoom) },
                geometry
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

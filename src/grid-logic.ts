import type { Feature, Polygon, GeoJsonProperties } from 'geojson';

// Grid configuration with decreasing cell sizes
export const GRID_LEVELS = [
    { min: 8, max: 11, size: 0.04 },
    { min: 11, max: 13, size: 0.02 },
    { min: 13, max: 15, size: 0.01 },
    { min: 15, max: 22, size: 0.005 }
];

// Grid boundaries (Lisbon)
export const LISBON_BBOX = [-9.3, 38.6, -9.0, 38.8];
// Grid origin point (Top-Left)
export const ORIGIN = [LISBON_BBOX[0], LISBON_BBOX[3]];

/**
 * Generates grid features based on the current viewport bounds and zoom level.
 * @param viewBounds [west, south, east, north]
 * @param zoom Current zoom level
 */
export function generateGridFeatures(
    viewBounds: [number, number, number, number],
    zoom: number
): Feature<Polygon, GeoJsonProperties>[] {
    const level = GRID_LEVELS.find(l => zoom >= l.min && zoom < l.max);
    if (!level) return [];

    const [viewWest, viewSouth, viewEast, viewNorth] = viewBounds;

    // Snap grid to origin
    const size = level.size;

    // Calculate horizontal grid indices
    const startCol = Math.floor((viewWest - ORIGIN[0]) / size);
    const endCol = Math.ceil((viewEast - ORIGIN[0]) / size);

    // Calculate vertical grid indices
    const startRow = Math.floor((ORIGIN[1] - viewNorth) / size);
    const endRow = Math.ceil((ORIGIN[1] - viewSouth) / size);

    const features: Feature<Polygon, GeoJsonProperties>[] = [];

    // Dynamic grid parameters
    const rootSize = GRID_LEVELS[0].size;
    const gridWidth = Math.ceil((LISBON_BBOX[2] - LISBON_BBOX[0]) / rootSize);
    const epsilon = 0.000001;

    for (let col = startCol; col < endCol; col++) {
        for (let row = startRow; row < endRow; row++) {
            const x1 = ORIGIN[0] + col * size;
            const x2 = ORIGIN[0] + (col + 1) * size;
            const y1 = ORIGIN[1] - row * size;
            const y2 = ORIGIN[1] - (row + 1) * size;

            const geometry: Polygon = {
                type: 'Polygon',
                coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]
            };

            const cx = x1 + size / 2;
            const cy = y1 - size / 2;

            // Base 26 Root ID
            const rootCol = Math.floor((cx - ORIGIN[0] + epsilon) / rootSize);
            const rootRow = Math.floor((ORIGIN[1] - cy + epsilon) / rootSize);
            let id = toBase26(rootRow * gridWidth + rootCol);

            // Alternating subdivision IDs
            let currentSize = rootSize;
            let depth = 0;
            while (currentSize > level.size * 1.01) {
                const half = currentSize / 2;
                const xBit = ((cx - ORIGIN[0]) % currentSize) >= (half - epsilon) ? 1 : 0;
                const yBit = ((ORIGIN[1] - cy) % currentSize) >= (half - epsilon) ? 1 : 0;

                id += (depth % 2 === 0)
                    ? (yBit * 2 + xBit).toString()
                    : ['A', 'B', 'C', 'D'][yBit * 2 + xBit];

                currentSize = half;
                depth++;
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

import './style.css'
import mapboxgl from 'mapbox-gl';
import Alpine from 'alpinejs'

window.Alpine = Alpine
Alpine.start()

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72],
    zoom: 10
});

// Grid configuration with decreasing cell sizes
const GRID_LEVELS = [
    { min: 8, max: 11, size: 0.04 },
    { min: 11, max: 13, size: 0.02 },
    { min: 13, max: 15, size: 0.01 },
    { min: 15, max: 22, size: 0.005 }
];

// Grid boundaries (Lisbon)
const LISBON_BBOX = [-9.3, 38.6, -9.0, 38.8];
// Grid origin point (Top-Left)
const ORIGIN = [LISBON_BBOX[0], LISBON_BBOX[3]];

let selectedSquare: string | null = null;

map.on('load', () => {
    map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
        id: 'grid-fill', type: 'fill', source: 'grid',
        paint: {
            'fill-color': ['case', ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)', 'rgba(0, 100, 200, 0.3)'],
            'fill-outline-color': 'rgba(0, 100, 200, 0.5)'
        }
    });

    map.addLayer({
        id: 'grid-labels', type: 'symbol', source: 'grid',
        layout: { 'text-field': ['get', 'id'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': 'white', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1 }
    });

    updateGrid();
});

map.on('moveend', updateGrid);
map.on('click', 'grid-fill', (e) => {
    const f = e.features?.[0];
    if (f) {
        selectedSquare = selectedSquare === f.properties?.id ? null : f.properties?.id;
        map.setPaintProperty('grid-fill', 'fill-color', ['case', ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)', 'rgba(0, 100, 200, 0.3)']);
    }
});

function updateGrid() {
    const zoom = map.getZoom();
    const level = GRID_LEVELS.find(l => zoom >= l.min && zoom < l.max);
    if (!level) return setGrid({ type: 'FeatureCollection', features: [] });

    const bounds = map.getBounds()!;

    // Intersect viewport with grid bounds
    const viewWest = Math.max(bounds.getWest(), LISBON_BBOX[0]);
    const viewSouth = Math.max(bounds.getSouth(), LISBON_BBOX[1]);
    const viewEast = Math.min(bounds.getEast(), LISBON_BBOX[2]);
    const viewNorth = Math.min(bounds.getNorth(), LISBON_BBOX[3]);

    if (viewWest >= viewEast || viewSouth >= viewNorth) {
        return setGrid({ type: 'FeatureCollection', features: [] });
    }

    // Snap grid to origin
    const size = level.size;

    // Calculate horizontal grid indices
    const startCol = Math.floor((viewWest - ORIGIN[0]) / size);
    const endCol = Math.ceil((viewEast - ORIGIN[0]) / size);

    // Calculate vertical grid indices
    const startRow = Math.floor((ORIGIN[1] - viewNorth) / size);
    const endRow = Math.ceil((ORIGIN[1] - viewSouth) / size);

    const features = [];

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

            const geometry = {
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

    setGrid({ type: 'FeatureCollection', features });
}

function setGrid(data: any) {
    (map.getSource('grid') as mapboxgl.GeoJSONSource)?.setData(data);
}

// Convert index to Base 26 (A-Z, AA-ZZ)
function toBase26(n: number): string {
    let s = "";
    while (n >= 0) {
        s = String.fromCharCode((n % 26) + 65) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}

import './style.css'
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import Alpine from 'alpinejs'

window.Alpine = Alpine
Alpine.start()

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72], // Lisbon center
    zoom: 10
});

// Lisbon bounding box for grid limits
const LISBON_BBOX = [-9.3, 38.6, -9.0, 38.8];

// Configuration for grid levels: min zoom (inclusive), max zoom (exclusive), cell size (degrees)
const GRID_LEVELS = [
    { min: 8, max: 11, size: 0.05 },
    { min: 11, max: 14, size: 0.02 },
    { min: 14, max: 22, size: 0.005 }
];

let selectedSquare: string | null = null;

map.on('load', () => {
    // Add grid source
    map.addSource('grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // Single fill layer for all grid sizes
    map.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: 'grid',
        paint: {
            'fill-color': [
                'case',
                ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)',
                'rgba(0, 100, 200, 0.3)'
            ],
            'fill-outline-color': 'rgba(0, 100, 200, 0.5)'
        }
    });

    // Labels
    map.addLayer({
        id: 'grid-labels',
        type: 'symbol',
        source: 'grid',
        layout: {
            'text-field': ['get', 'id'],
            'text-size': 12,
            'text-allow-overlap': false
        },
        paint: {
            'text-color': 'white',
            'text-halo-color': 'rgba(0,0,0,0.7)',
            'text-halo-width': 1
        }
    });

    // Initial grid
    updateGrid();
});

// Update grid on move/zoom
map.on('moveend', updateGrid);

function updateGrid() {
    const zoom = map.getZoom();

    // Find active grid level configuration
    const level = GRID_LEVELS.find(l => zoom >= l.min && zoom < l.max);

    // If no level matches or zoomed out too far, clear grid
    if (!level) {
        setGridData({ type: 'FeatureCollection', features: [] });
        return;
    }

    // Clip to Lisbon bounds
    const bounds = map.getBounds();
    if (!bounds) return;

    // Calculate visible bbox within Lisbon bounds
    const bbox: [number, number, number, number] = [
        Math.max(bounds.getWest(), LISBON_BBOX[0]),
        Math.max(bounds.getSouth(), LISBON_BBOX[1]),
        Math.min(bounds.getEast(), LISBON_BBOX[2]),
        Math.min(bounds.getNorth(), LISBON_BBOX[3])
    ];

    // If view is completely outside, clear grid
    if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
        setGridData({ type: 'FeatureCollection', features: [] });
        return;
    }

    const grid = turf.squareGrid(bbox, level.size, { units: 'degrees' });

    // Add IDs
    grid.features.forEach((feature, index) => {
        // Simple base36 ID generation
        feature.properties = {
            id: index.toString(36).toUpperCase(),
            zoom: Math.round(zoom)
        };
    });

    setGridData(grid);
}

function setGridData(data: any) {
    const source = map.getSource('grid') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
        source.setData(data);
    }
}

// Click handler
map.on('click', 'grid-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature || !feature.properties) return;

    // Toggle selection: deselect if clicking same square
    if (selectedSquare === feature.properties.id) {
        selectedSquare = null;
    } else {
        selectedSquare = feature.properties.id;
    }

    // Update paint property to reflect selection
    map.setPaintProperty('grid-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)',
        'rgba(0, 100, 200, 0.3)'
    ]);

    // Fly to clicked square if selected
    if (selectedSquare && feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        // Calculate bounds of polygon
        const lngs = coords.map((c: any) => c[0]);
        const lats = coords.map((c: any) => c[1]);
        map.fitBounds([
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)]
        ], { padding: 20 });
    }
});

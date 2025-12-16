import './style.css'
import mapboxgl from 'mapbox-gl';
import Alpine from 'alpinejs'
import { generateGridFeatures, configureGrid } from './grid-logic';
import type { FeatureCollection } from 'geojson';
import cmetData from './assets/cmet_service_areas.json';
import { bbox } from '@turf/turf';

window.Alpine = Alpine
Alpine.start()

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72],
    zoom: 10
});

let selectedSquare: string | null = null;

// Validate GeoJSON data at runtime to ensure type safety
const cmet = cmetData as unknown as FeatureCollection;
if (!cmet.type || cmet.type !== 'FeatureCollection' || !Array.isArray(cmet.features)) {
    throw new Error('Invalid GeoJSON: cmetData must be a FeatureCollection');
}

map.on('load', () => {
    // Fit map to cmetData bounds
    const bounds = bbox(cmet);
    map.fitBounds([bounds[0], bounds[1], bounds[2], bounds[3]], { padding: 20 });


    // Initialize grid system with data bounds
    configureGrid(cmet, [bounds[0], bounds[1], bounds[2], bounds[3]]);

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

    map.addSource('cmet', {
        type: 'geojson',
        data: cmet
    });

    map.addLayer({
        id: 'cmet-border',
        type: 'line',
        source: 'cmet',
        paint: {
            'line-color': '#00ff00',
            'line-width': 2
        }
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
    const bounds = map.getBounds();
    if (!bounds) return;

    // Intersect viewport with grid bounds
    const cmetBounds = bbox(cmet);
    const viewWest = Math.max(bounds.getWest(), cmetBounds[0]);
    const viewSouth = Math.max(bounds.getSouth(), cmetBounds[1]);
    const viewEast = Math.min(bounds.getEast(), cmetBounds[2]);
    const viewNorth = Math.min(bounds.getNorth(), cmetBounds[3]);

    if (viewWest >= viewEast || viewSouth >= viewNorth) {
        return setGrid({ type: 'FeatureCollection', features: [] });
    }

    const features = generateGridFeatures(
        [viewWest, viewSouth, viewEast, viewNorth],
        zoom
    );
    setGrid({ type: 'FeatureCollection', features });
}

function setGrid(data: FeatureCollection) {
    const source = map.getSource('grid');
    if (source && source.type === 'geojson') {
        (source as mapboxgl.GeoJSONSource).setData(data);
    }
}
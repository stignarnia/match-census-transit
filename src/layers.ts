import { bbox } from '@turf/turf';
import cmetData from './assets/cmet_service_areas.json';
import type { FeatureCollection } from 'geojson';

// GeoJSON validation
const cmet = cmetData as unknown as FeatureCollection;
if (!cmet.type || cmet.type !== 'FeatureCollection' || !Array.isArray(cmet.features)) {
    throw new Error('Invalid GeoJSON: cmetData must be a FeatureCollection');
}

export interface LayerTheme {
    COLOR_BGRI_FILL: string;
    COLOR_CMET_BORDER: string;
    COLOR_BEST: string;
    COLOR_CENTROID_STROKE: string;
    COLOR_WORST: string;
    COLOR_CONNECTION_BORDER: string;
    COLOR_CONNECTION_LABEL_TEXT: string;
    COLOR_CONNECTION_LABEL_HALO: string;
}

export function setupMapLayers(map: mapboxgl.Map, theme: LayerTheme) {
    const bounds = bbox(cmet);
    const cmetBounds: [number, number, number, number] = [
        bounds[0],
        bounds[1],
        bounds[2],
        bounds[3]
    ];

    map.fitBounds(cmetBounds, { padding: 20 });

    // BGRI Census Data (Underneath grid)
    map.addSource('bgri', {
        type: 'vector',
        url: 'mapbox://stignarnia.fukjd3p5wied'
    });

    map.addLayer({
        id: 'bgri-fill',
        type: 'fill',
        source: 'bgri',
        'source-layer': 'a8812bf3a307811dd19e',
        paint: {
            'fill-color': theme.COLOR_BGRI_FILL,
            'fill-outline-color': theme.COLOR_BGRI_FILL,
            'fill-emissive-strength': 1
        }
    });

    // CMET border
    map.addSource('cmet', { type: 'geojson', data: cmet });
    map.addLayer({
        id: 'cmet-border',
        type: 'line',
        source: 'cmet',
        paint: { 'line-color': theme.COLOR_CMET_BORDER, 'line-width': 2, 'line-emissive-strength': 1 }
    });

    // Centroids
    map.addSource('centroids', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'first-centroid',
        type: 'circle',
        source: 'centroids',
        filter: ['==', ['get', 'type'], 'first'],
        paint: {
            'circle-radius': 8,
            'circle-color': theme.COLOR_BEST,
            'circle-stroke-color': theme.COLOR_CENTROID_STROKE,
            'circle-stroke-width': 3,
            'circle-opacity': 1,
            'circle-emissive-strength': 1
        }
    });

    map.addLayer({
        id: 'second-centroid',
        type: 'circle',
        source: 'centroids',
        filter: ['==', ['get', 'type'], 'second'],
        paint: {
            'circle-radius': 8,
            'circle-color': theme.COLOR_WORST,
            'circle-stroke-color': theme.COLOR_CENTROID_STROKE,
            'circle-stroke-width': 3,
            'circle-opacity': 1,
            'circle-emissive-strength': 1
        }
    });

    // Connection line
    map.addSource('connection-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'connection-line-border',
        type: 'line',
        source: 'connection-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.COLOR_CONNECTION_BORDER, 'line-width': 18, 'line-opacity': 1, 'line-emissive-strength': 1 }
    });

    map.addLayer({
        id: 'connection-line-layer',
        type: 'line',
        source: 'connection-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.COLOR_WORST, 'line-width': 12, 'line-opacity': 1, 'line-emissive-strength': 1 }
    });

    // Connection Label
    map.addSource('connection-label', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'connection-label-layer',
        type: 'symbol',
        source: 'connection-label',
        layout: {
            'text-field': ['get', 'label'],
            'text-size': 14,
            'text-anchor': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: {
            'text-color': theme.COLOR_CONNECTION_LABEL_TEXT,
            'text-halo-color': theme.COLOR_CONNECTION_LABEL_HALO,
            'text-halo-width': 2,
            'text-emissive-strength': 1
        }
    });
}

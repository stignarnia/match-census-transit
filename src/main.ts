import './style.css'
import mapboxgl from 'mapbox-gl';
import Alpine from 'alpinejs'
import { generateGridFeatures, configureGrid } from './grid-logic';
import type { FeatureCollection } from 'geojson';
import cmetData from './assets/cmet_service_areas.json';
import { bbox, centroid } from '@turf/turf';
import { fetchRouteData } from './google-routes';

window.Alpine = Alpine
Alpine.start()

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72],
    zoom: 10
});

let firstSelection: string | null = null;
let secondSelection: string | null = null;
let firstSelectionCentroid: { lat: number, lng: number } | null = null;
let secondSelectionCentroid: { lat: number, lng: number } | null = null;
let animationFrameId: number | null = null;

// Runtime validation of GeoJSON
const cmet = cmetData as unknown as FeatureCollection;
if (!cmet.type || cmet.type !== 'FeatureCollection' || !Array.isArray(cmet.features)) {
    throw new Error('Invalid GeoJSON: cmetData must be a FeatureCollection');
}

map.on('load', () => {
    // Fit map to data bounds
    const bounds = bbox(cmet);
    map.fitBounds([bounds[0], bounds[1], bounds[2], bounds[3]], { padding: 20 });

    // Initialize grid
    configureGrid(cmet, [bounds[0], bounds[1], bounds[2], bounds[3]]);

    map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
        id: 'grid-fill', type: 'fill', source: 'grid',
        paint: {
            'fill-color': 'rgba(0, 100, 200, 0.3)',
            'fill-outline-color': 'rgba(0, 100, 200, 0.5)'
        }
    });
    updateSelectionVisuals();

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

    // Centroid markers source
    map.addSource('centroids', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // First selection centroid (green dot)
    map.addLayer({
        id: 'first-centroid',
        type: 'circle',
        source: 'centroids',
        filter: ['==', ['get', 'type'], 'first'],
        paint: {
            'circle-radius': 8,
            'circle-color': '#10b981', // green-500
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
            'circle-opacity': 1
        }
    });

    // Second selection centroid (red dot)
    map.addLayer({
        id: 'second-centroid',
        type: 'circle',
        source: 'centroids',
        filter: ['==', ['get', 'type'], 'second'],
        paint: {
            'circle-radius': 8,
            'circle-color': '#ef4444', // red-500
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
            'circle-opacity': 1
        }
    });

    // Connection Line Source
    map.addSource('connection-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // Single connection line layer
    map.addLayer({
        id: 'connection-line-layer',
        type: 'line',
        source: 'connection-line',
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        },
        paint: {
            'line-color': '#ef4444',
            'line-width': 4,
            'line-opacity': 0.8
        }
    });

    updateGrid();
});

map.on('moveend', updateGrid);
map.on('click', 'grid-fill', handleGridClick);

async function handleGridClick(e: mapboxgl.MapLayerMouseEvent) {
    const feature = e.features?.[0];
    if (!feature?.properties?.id) return;

    const id = feature.properties.id;
    const centerPoint = centroid(feature);
    const coords = centerPoint.geometry.coordinates;
    const clickedCentroid = { lng: coords[0], lat: coords[1] };

    if (!firstSelection) {
        firstSelection = id;
        firstSelectionCentroid = clickedCentroid;
        secondSelection = null;
        secondSelectionCentroid = null;
        resetConnectionLine();
        updateCentroids();
        updateSelectionVisuals();
    } else if (!secondSelection && id !== firstSelection) {
        secondSelection = id;
        secondSelectionCentroid = clickedCentroid;

        // IMMEDIATELY show red dot and red background
        updateCentroids();
        updateSelectionVisuals();

        if (firstSelectionCentroid) {
            // ONLY animate the line AFTER visuals are updated
            animateLineDraw([firstSelectionCentroid.lng, firstSelectionCentroid.lat], [clickedCentroid.lng, clickedCentroid.lat]);

            // Trigger API Logic
            console.log(`Calculating route from ${firstSelection} to ${secondSelection}...`);
            const results = await fetchRouteData(firstSelectionCentroid, clickedCentroid);

            console.log('--- Route Results ---');
            console.log(`Origin: ${firstSelection}, Destination: ${secondSelection}`);

            if (results.drive.duration || results.drive.distanceMeters) {
                const minutes = results.drive.duration ? parseInt(results.drive.duration.replace('s', '')) / 60 : 0;
                console.log(`DRIVE (Traffic Aware): ${minutes.toFixed(1)} mins, ${(results.drive.distanceMeters || 0) / 1000} km`);
            } else {
                console.log('DRIVE: No route found or error.');
            }

            if (results.transit.duration || results.transit.distanceMeters) {
                const minutes = results.transit.duration ? parseInt(results.transit.duration.replace('s', '')) / 60 : 0;
                console.log(`TRANSIT: ${minutes.toFixed(1)} mins, ${(results.drive.distanceMeters || 0) / 1000} km`);
            } else {
                console.log('TRANSIT: No route found or error.');
            }
        }
    } else {
        firstSelection = id;
        firstSelectionCentroid = clickedCentroid;
        secondSelection = null;
        secondSelectionCentroid = null;
        resetConnectionLine();
        updateCentroids();
        updateSelectionVisuals();
    }
}

function updateCentroids() {
    const features: any[] = [];

    if (firstSelectionCentroid) {
        features.push({
            type: 'Feature',
            properties: { type: 'first' },
            geometry: {
                type: 'Point',
                coordinates: [firstSelectionCentroid.lng, firstSelectionCentroid.lat]
            }
        });
    }

    if (secondSelectionCentroid) {
        features.push({
            type: 'Feature',
            properties: { type: 'second' },
            geometry: {
                type: 'Point',
                coordinates: [secondSelectionCentroid.lng, secondSelectionCentroid.lat]
            }
        });
    }

    const source = map.getSource('centroids') as mapboxgl.GeoJSONSource;
    if (source) {
        source.setData({ type: 'FeatureCollection', features });
    }
}

function animateLineDraw(start: [number, number], end: [number, number]) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const duration = 500; // 500ms total
    let startTime: number;

    function frame(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);

        // Smooth easing
        const ease = 1 - Math.pow(1 - progress, 3);

        // Interpolate between start and end
        const currentEnd: [number, number] = [
            start[0] + (end[0] - start[0]) * ease,
            start[1] + (end[1] - start[1]) * ease
        ];

        const source = map.getSource('connection-line') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: [start, currentEnd]
                    }
                }]
            });
        }

        if (progress < 1) {
            animationFrameId = requestAnimationFrame(frame);
        } else {
            animationFrameId = null;
        }
    }

    animationFrameId = requestAnimationFrame(frame);
}

function resetConnectionLine() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    const source = map.getSource('connection-line') as mapboxgl.GeoJSONSource;
    if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
    }
}

function updateSelectionVisuals() {
    map.setPaintProperty('grid-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], firstSelection || ''], 'rgba(0, 255, 0, 0.8)',
        ['==', ['get', 'id'], secondSelection || ''], 'rgba(255, 100, 100, 0.8)',
        'rgba(0, 100, 200, 0.3)'
    ]);
}

function updateGrid() {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    if (!bounds) return;

    const cmetBounds = bbox(cmet);
    const viewWest = Math.max(bounds.getWest(), cmetBounds[0]);
    const viewSouth = Math.max(bounds.getSouth(), cmetBounds[1]);
    const viewEast = Math.min(bounds.getEast(), cmetBounds[2]);
    const viewNorth = Math.min(bounds.getNorth(), cmetBounds[3]);

    if (viewWest >= viewEast || viewSouth >= viewNorth) {
        return setGrid({ type: 'FeatureCollection', features: [] });
    }

    const features = generateGridFeatures([viewWest, viewSouth, viewEast, viewNorth], zoom);
    setGrid({ type: 'FeatureCollection', features });
}

function setGrid(data: FeatureCollection) {
    const source = map.getSource('grid');
    if (source && source.type === 'geojson') {
        (source as mapboxgl.GeoJSONSource).setData(data);
    }
}
import './style.css';
import mapboxgl from 'mapbox-gl';
import { generateGridFeatures, configureGrid } from './grid-logic';
import type { FeatureCollection, Feature } from 'geojson';
import cmetData from './assets/cmet_service_areas.json';
import { bbox, centroid } from '@turf/turf';
import { fetchRouteData } from './google-routes';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72],
    zoom: 10
});

// Selection state
let firstSelection: string | null = null;
let secondSelection: string | null = null;
let firstSelectionCentroid: { lat: number; lng: number } | null = null;
let secondSelectionCentroid: { lat: number; lng: number } | null = null;

// Animation state
let animationFrameId: number | null = null;

// GeoJSON validation
const cmet = cmetData as unknown as FeatureCollection;
if (!cmet.type || cmet.type !== 'FeatureCollection' || !Array.isArray(cmet.features)) {
    throw new Error('Invalid GeoJSON: cmetData must be a FeatureCollection');
}

// Helper to get centroid for a grid feature
function getFeatureCentroid(feature: Feature): { lng: number; lat: number } {
    const centerPoint = centroid(feature);
    const coords = centerPoint.geometry.coordinates as [number, number];
    return { lng: coords[0], lat: coords[1] };
}

// Duration parsing
function parseDurationSeconds(duration?: string | null): number {
    if (!duration) return 0;
    const seconds = parseInt(duration.replace('s', ''), 10);
    return Number.isFinite(seconds) ? seconds : 0;
}

// Convenience source getter
function getGeoJSONSource(id: string): mapboxgl.GeoJSONSource | null {
    const source = map.getSource(id);
    return source ? (source as mapboxgl.GeoJSONSource) : null;
}

// Centralized visuals update
function refreshVisuals() {
    updateCentroids();
    updateSelectionVisuals();
}

// Map setup
map.on('load', () => {
    const bounds = bbox(cmet);
    const cmetBounds: [number, number, number, number] = [
        bounds[0],
        bounds[1],
        bounds[2],
        bounds[3]
    ];

    map.fitBounds(cmetBounds, { padding: 20 });

    configureGrid(cmet, cmetBounds);

    // Grid
    map.addSource('grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        maxzoom: 14
    });

    map.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: 'grid',
        paint: {
            'fill-color': 'rgba(0, 100, 200, 0.3)',
            'fill-outline-color': 'rgba(0, 100, 200, 0.5)'
        }
    });

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

    // CMET border
    map.addSource('cmet', { type: 'geojson', data: cmet });
    map.addLayer({
        id: 'cmet-border',
        type: 'line',
        source: 'cmet',
        paint: { 'line-color': '#00ff00', 'line-width': 2 }
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
            'circle-color': '#10b981',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
            'circle-opacity': 1
        }
    });

    map.addLayer({
        id: 'second-centroid',
        type: 'circle',
        source: 'centroids',
        filter: ['==', ['get', 'type'], 'second'],
        paint: {
            'circle-radius': 8,
            'circle-color': '#ef4444',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
            'circle-opacity': 1
        }
    });

    // Connection line
    map.addSource('connection-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'connection-line-layer',
        type: 'line',
        source: 'connection-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ef4444', 'line-width': 4, 'line-opacity': 0.8 }
    });

    // Initial visuals + grid
    refreshVisuals();
    updateGrid();
});

// Events
map.on('moveend', updateGrid);
map.on('click', 'grid-fill', handleGridClick);

// Click handler
async function handleGridClick(e: mapboxgl.MapLayerMouseEvent) {
    const feature = e.features?.[0] as Feature | undefined;
    const id = feature?.properties?.id as string | undefined;
    if (!feature || !id) return;

    const clickedCentroid = getFeatureCentroid(feature);

    const selectingNewFirst =
        !firstSelection || (firstSelection && secondSelection && id !== firstSelection);

    if (selectingNewFirst) {
        firstSelection = id;
        firstSelectionCentroid = clickedCentroid;
        secondSelection = null;
        secondSelectionCentroid = null;
        resetConnectionLine();
        refreshVisuals();
        return;
    }

    if (!secondSelection && id !== firstSelection) {
        secondSelection = id;
        secondSelectionCentroid = clickedCentroid;

        refreshVisuals();

        if (firstSelectionCentroid) {
            animateLineDraw(
                [firstSelectionCentroid.lng, firstSelectionCentroid.lat],
                [clickedCentroid.lng, clickedCentroid.lat]
            );

            console.log(`Calculating route from ${firstSelection} to ${secondSelection}...`);
            const results = await fetchRouteData(firstSelectionCentroid, clickedCentroid);

            console.log('--- Route Results ---');
            console.log(`Origin: ${firstSelection}, Destination: ${secondSelection}`);

            if (results.drive?.duration || results.drive?.distanceMeters) {
                const minutes = parseDurationSeconds(results.drive?.duration) / 60;
                console.log(
                    `DRIVE (Traffic Aware): ${minutes.toFixed(1)} mins, ${(results.drive?.distanceMeters || 0) / 1000
                    } km`
                );
            } else {
                console.log('DRIVE: No route found or error.');
            }

            if (results.transit?.duration || results.transit?.distanceMeters) {
                const minutes = parseDurationSeconds(results.transit?.duration) / 60;
                console.log(
                    `TRANSIT: ${minutes.toFixed(1)} mins, ${(results.transit?.distanceMeters || 0) / 1000
                    } km`
                );
            } else {
                console.log('TRANSIT: No route found or error.');
            }
        }
        return;
    }

    // Replace first selection when clicking another cell
    firstSelection = id;
    firstSelectionCentroid = clickedCentroid;
    secondSelection = null;
    secondSelectionCentroid = null;
    resetConnectionLine();
    refreshVisuals();
}

// Centroid source updates
function updateCentroids() {
    const features: Feature[] = [];

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

    const source = getGeoJSONSource('centroids');
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features });
}

// Line animation
function animateLineDraw(start: [number, number], end: [number, number]) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const source = getGeoJSONSource('connection-line');
    if (!source) return;

    const duration = 500;
    let startTime = 0;

    function frame(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const currentEnd: [number, number] = [
            start[0] + (end[0] - start[0]) * ease,
            start[1] + (end[1] - start[1]) * ease
        ];

        const liveSource = getGeoJSONSource('connection-line');
        if (!liveSource) {
            animationFrameId = null;
            return;
        }

        liveSource.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: [start, currentEnd] }
                }
            ]
        });

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
    const source = getGeoJSONSource('connection-line');
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features: [] });
}

// Selection visuals
function updateSelectionVisuals() {
    if (!map.getLayer('grid-fill')) return;

    map.setPaintProperty('grid-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], firstSelection || ''],
        'rgba(0, 255, 0, 0.8)',
        ['==', ['get', 'id'], secondSelection || ''],
        'rgba(255, 100, 100, 0.8)',
        'rgba(0, 100, 200, 0.3)'
    ]);
}

// Grid generation
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

    const features = generateGridFeatures(
        [viewWest, viewSouth, viewEast, viewNorth],
        zoom
    );
    setGrid({ type: 'FeatureCollection', features });
}

function setGrid(data: FeatureCollection) {
    const source = getGeoJSONSource('grid');
    if (!source) return;

    source.setData(data);
}
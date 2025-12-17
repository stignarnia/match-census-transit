import './style.css';
import mapboxgl from 'mapbox-gl';
import { generateGridFeatures, configureGrid } from './grid-logic';
import type { FeatureCollection, Feature } from 'geojson';
import cmetData from './assets/cmet_service_areas.json';
import { bbox, centroid } from '@turf/turf';
import { fetchRouteData } from './google-routes';
import Alpine from 'alpinejs';
import calendar from './calendar';

Alpine.data('calendar', calendar);
Alpine.start();

// Color Palette
const COLOR_BEST = '#10b981';
const COLOR_WORST = '#ef4444';
const COLOR_GRID_FILL = 'rgba(0, 100, 200, 0.3)';
const COLOR_GRID_OUTLINE = 'rgba(0, 100, 200, 0.5)';
const COLOR_TEXT_LABEL = 'white';
const COLOR_TEXT_HALO = 'rgba(0,0,0,0.7)';
const COLOR_CMET_BORDER = '#00ff00';
const COLOR_CENTROID_STROKE = 'white';
const COLOR_CONNECTION_BORDER = '#ffffff';
const COLOR_CONNECTION_LABEL_TEXT = '#ffffff';
const COLOR_CONNECTION_LABEL_HALO = '#000000';
const COLOR_GRAY = '#9ca3af';
const COLOR_SELECTION_FIRST = 'rgba(0, 255, 0, 0.8)';
const COLOR_SELECTION_SECOND = 'rgba(255, 100, 100, 0.8)';

// Color thresholds
const THRESHOLD_BEST = 100;
const THRESHOLD_WORST = 300;

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/standard',
    config: {
        basemap: {
            lightPreset: "night"
        }
    },
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

// Time state
let latestCalendarTime: Date = new Date();
window.addEventListener('calendar-time-update', (e: Event) => {
    latestCalendarTime = (e as CustomEvent).detail.date;
});

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

function interpolateColor(color1: string, color2: string, factor: number): string {
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);

    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);

    const r = Math.round(r1 + factor * (r2 - r1));
    const g = Math.round(g1 + factor * (g2 - g1));
    const b = Math.round(b1 + factor * (b2 - b1));

    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function getLineColor(percentage: number): string {
    if (percentage <= THRESHOLD_BEST) return COLOR_BEST;
    if (percentage >= THRESHOLD_WORST) return COLOR_WORST;

    const factor = (percentage - THRESHOLD_BEST) / (THRESHOLD_WORST - THRESHOLD_BEST);
    return interpolateColor(COLOR_BEST, COLOR_WORST, factor);
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
            'fill-color': COLOR_GRID_FILL,
            'fill-outline-color': COLOR_GRID_OUTLINE,
            'fill-emissive-strength': 1
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
            'text-color': COLOR_TEXT_LABEL,
            'text-halo-color': COLOR_TEXT_HALO,
            'text-halo-width': 1,
            'text-emissive-strength': 1
        }
    });

    // CMET border
    map.addSource('cmet', { type: 'geojson', data: cmet });
    map.addLayer({
        id: 'cmet-border',
        type: 'line',
        source: 'cmet',
        paint: { 'line-color': COLOR_CMET_BORDER, 'line-width': 2, 'line-emissive-strength': 1 }
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
            'circle-color': COLOR_BEST,
            'circle-stroke-color': COLOR_CENTROID_STROKE,
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
            'circle-color': COLOR_WORST,
            'circle-stroke-color': COLOR_CENTROID_STROKE,
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
        paint: { 'line-color': COLOR_CONNECTION_BORDER, 'line-width': 18, 'line-opacity': 1, 'line-emissive-strength': 1 }
    });

    map.addLayer({
        id: 'connection-line-layer',
        type: 'line',
        source: 'connection-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLOR_WORST, 'line-width': 12, 'line-opacity': 1, 'line-emissive-strength': 1 }
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
            'text-color': COLOR_CONNECTION_LABEL_TEXT,
            'text-halo-color': COLOR_CONNECTION_LABEL_HALO,
            'text-halo-width': 2,
            'text-emissive-strength': 1
        }
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
            const results = await fetchRouteData(firstSelectionCentroid, clickedCentroid, latestCalendarTime);

            const driveSeconds = parseDurationSeconds(results.drive?.duration);
            const transitSeconds = parseDurationSeconds(results.transit?.duration);

            let labelText = '';
            let lineColor = COLOR_GRAY; // Default gray if indeterminable

            if (driveSeconds > 0 && transitSeconds > 0) {
                const percentage = Math.round((transitSeconds / driveSeconds) * 100);
                labelText = `${percentage}%`;
                lineColor = getLineColor(percentage);
            } else if (driveSeconds > 0) {
                labelText = 'No Transit';
                lineColor = COLOR_WORST;
            } else if (transitSeconds > 0) {
                labelText = 'No Drive';
                lineColor = COLOR_BEST; // Or another color for "Transit Only"? Sticking to best for now as it beats "No Drive".
            } else {
                labelText = 'N/A';
            }

            // Update line color
            if (map.getLayer('connection-line-layer')) {
                map.setPaintProperty('connection-line-layer', 'line-color', lineColor);
            }

            // Animate line
            animateLineDraw(
                [firstSelectionCentroid.lng, firstSelectionCentroid.lat],
                [clickedCentroid.lng, clickedCentroid.lat]
            );

            // Update label
            const midLng = (firstSelectionCentroid.lng + clickedCentroid.lng) / 2;
            const midLat = (firstSelectionCentroid.lat + clickedCentroid.lat) / 2;

            const labelSource = getGeoJSONSource('connection-label');
            if (labelSource) {
                labelSource.setData({
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        properties: { label: labelText },
                        geometry: {
                            type: 'Point',
                            coordinates: [midLng, midLat]
                        }
                    }]
                });
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

    const labelSource = getGeoJSONSource('connection-label');
    if (labelSource) {
        labelSource.setData({ type: 'FeatureCollection', features: [] });
    }
}

// Selection visuals
function updateSelectionVisuals() {
    if (!map.getLayer('grid-fill')) return;

    map.setPaintProperty('grid-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], firstSelection || ''],
        COLOR_SELECTION_FIRST,
        ['==', ['get', 'id'], secondSelection || ''],
        COLOR_SELECTION_SECOND,
        COLOR_GRID_FILL
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
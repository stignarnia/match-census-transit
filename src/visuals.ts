import { getGeoJSONSource } from './utils';
import { SOURCE_LAYER_HEATMAP } from './constants';

export interface VisualsTheme {
    COLOR_SELECTION_FIRST: string;
    COLOR_SELECTION_SECOND: string;
    COLOR_BGRI_FILL: string;
}

// Animation state
let animationFrameId: number | null = null;

// Centroid source updates
// Manage feature states for point selection
export function updatePointSelection(
    map: mapboxgl.Map,
    firstId: string | null,
    secondId: string | null
) {
    const sourceId = 'bgri-heatmap';
    const sourceLayer = SOURCE_LAYER_HEATMAP;

    // Clear all feature states for this source layer
    map.removeFeatureState({ source: sourceId, sourceLayer });

    // Set new states
    if (firstId) {
        map.setFeatureState(
            { source: sourceId, sourceLayer, id: firstId },
            { selected: true, selectionType: 'first' }
        );
    }
    if (secondId) {
        map.setFeatureState(
            { source: sourceId, sourceLayer, id: secondId },
            { selected: true, selectionType: 'second' }
        );
    }
}

// Line animation
export function animateLineDraw(map: mapboxgl.Map, start: [number, number], end: [number, number]) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const source = getGeoJSONSource(map, 'connection-line');
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

        const liveSource = getGeoJSONSource(map, 'connection-line');
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

export function resetConnectionLine(map: mapboxgl.Map) {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    const source = getGeoJSONSource(map, 'connection-line');
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features: [] });

    const labelSource = getGeoJSONSource(map, 'connection-label');
    if (labelSource) {
        labelSource.setData({ type: 'FeatureCollection', features: [] });
    }
}

// Selection visuals
export function updateSelectionVisuals(
    map: mapboxgl.Map,
    firstSelection: string | null,
    secondSelection: string | null,
    theme: VisualsTheme,
    baseFillColor: any
) {
    if (!map.getLayer('bgri-fill')) return;

    // Use BGRI2021 for selection logic
    map.setPaintProperty('bgri-fill', 'fill-color', [
        'case',
        ['==', ['get', 'BGRI2021'], firstSelection || ''],
        theme.COLOR_SELECTION_FIRST,
        ['==', ['get', 'BGRI2021'], secondSelection || ''],
        theme.COLOR_SELECTION_SECOND,
        baseFillColor
    ]);
}

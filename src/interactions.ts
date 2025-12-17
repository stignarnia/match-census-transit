import type { Feature } from 'geojson';
import { map } from './map';
import { appState } from './state';
import { fetchRouteData } from './google-routes';
import {
    COLOR_BEST,
    COLOR_WORST,
    COLOR_GRAY,
    COLOR_SELECTION_FIRST,
    COLOR_SELECTION_SECOND,
    COLOR_BGRI_FILL,
    THRESHOLD_BEST,
    THRESHOLD_WORST
} from './constants';
import {
    parseDurationSeconds,
    interpolateColor,
    getGeoJSONSource
} from './utils';
import {
    updatePointSelection,
    updateSelectionVisuals,
    animateLineDraw,
    resetConnectionLine
} from './visuals';

export function getLineColor(percentage: number): string {
    if (percentage <= THRESHOLD_BEST) return COLOR_BEST;
    if (percentage >= THRESHOLD_WORST) return COLOR_WORST;

    const factor = (percentage - THRESHOLD_BEST) / (THRESHOLD_WORST - THRESHOLD_BEST);
    return interpolateColor(COLOR_BEST, COLOR_WORST, factor);
}

export function refreshVisuals() {
    updatePointSelection(map, appState.firstSelection, appState.secondSelection);
    updateSelectionVisuals(map, appState.firstSelection, appState.secondSelection, {
        COLOR_SELECTION_FIRST,
        COLOR_SELECTION_SECOND,
        COLOR_BGRI_FILL
    }, appState.currentFillColorExpression || COLOR_BGRI_FILL);
}

// Click handler
export async function handleGridClick(e: mapboxgl.MapMouseEvent & { features?: Feature[] }) {
    // With vector tiles, we get features here
    const feature = e.features?.[0];

    // The user specified 'BGRI2021' as the ID field
    const id = feature?.properties?.BGRI2021;

    if (!feature || typeof id !== 'string') {
        // Just return if no feature or no ID
        return;
    }

    // Find the point feature in the heatmap layer that corresponds to this grid cell
    const pointFeatures = map.querySourceFeatures('bgri-heatmap', {
        sourceLayer: 'c921642b0ab40bb7d620',
        filter: ['==', 'BGRI2021', id]
    });

    if (!pointFeatures.length) {
        console.warn('Could not find corresponding point for grid cell', id);
        return;
    }

    const firstPoint = pointFeatures[0];
    if (firstPoint.geometry.type !== 'Point') return;

    const coords = firstPoint.geometry.coordinates; // TS knows this is Position (number[])
    const clickedCentroid = { lng: coords[0], lat: coords[1] };

    const selectingNewFirst =
        !appState.firstSelection ||
        (appState.firstSelection && appState.secondSelection && id !== appState.firstSelection);

    if (selectingNewFirst) {
        appState.firstSelection = id;
        appState.firstSelectionCentroid = clickedCentroid;
        appState.secondSelection = null;
        appState.secondSelectionCentroid = null;
        resetConnectionLine(map);
        refreshVisuals();
        return;
    }

    if (!appState.secondSelection && id !== appState.firstSelection) {
        appState.secondSelection = id;
        appState.secondSelectionCentroid = clickedCentroid;

        refreshVisuals();

        if (appState.firstSelectionCentroid) {
            const results = await fetchRouteData(
                appState.firstSelectionCentroid,
                clickedCentroid,
                appState.latestCalendarTime
            );

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
                lineColor = COLOR_BEST;
            } else {
                labelText = 'N/A';
            }

            // Update line color
            if (map.getLayer('connection-line-layer')) {
                map.setPaintProperty('connection-line-layer', 'line-color', lineColor);
            }

            // Animate line
            animateLineDraw(
                map,
                [appState.firstSelectionCentroid.lng, appState.firstSelectionCentroid.lat],
                [clickedCentroid.lng, clickedCentroid.lat]
            );

            // Update label
            const midLng = (appState.firstSelectionCentroid.lng + clickedCentroid.lng) / 2;
            const midLat = (appState.firstSelectionCentroid.lat + clickedCentroid.lat) / 2;

            const labelSource = getGeoJSONSource(map, 'connection-label');
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
    appState.firstSelection = id;
    appState.firstSelectionCentroid = clickedCentroid;
    appState.secondSelection = null;
    appState.secondSelectionCentroid = null;
    resetConnectionLine(map);
    refreshVisuals();
}

export function resetSelection() {
    appState.firstSelection = null;
    appState.firstSelectionCentroid = null;
    appState.secondSelection = null;
    appState.secondSelectionCentroid = null;
    resetConnectionLine(map);
    refreshVisuals();
}

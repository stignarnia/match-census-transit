import './style.css';
import Alpine from 'alpinejs';
import calendar from './calendar';
import { map } from './map';
import { setupMapLayers } from './layers';
import { appState } from './state';
import { handleGridClick, refreshVisuals, resetSelection } from './interactions';
import {
    COLOR_BEST,
    COLOR_WORST,
    COLOR_CENTROID_STROKE,
    COLOR_CONNECTION_BORDER,
    COLOR_CONNECTION_LABEL_TEXT,
    COLOR_CONNECTION_LABEL_HALO,
    COLOR_BGRI_FILL,
    COLOR_BGRI_OUTLINE,
    POPULATION_DENSITY_EXPRESSION,
    SOURCE_LAYER_BGRI,
    SOURCE_LAYER_HEATMAP
} from './constants';

const USE_POPULATION_HEATMAP = true;

Alpine.data('calendar', calendar);
Alpine.start();

// Time state
window.addEventListener('calendar-time-update', (e: Event) => {
    if (e instanceof CustomEvent) {
        appState.latestCalendarTime = e.detail.date;
    }
});

// Map setup
const initializeMap = () => {
    setupMapLayers(map, {
        COLOR_BGRI_FILL,
        COLOR_BEST,
        COLOR_CENTROID_STROKE,
        COLOR_WORST,
        COLOR_CONNECTION_BORDER,
        COLOR_CONNECTION_LABEL_TEXT,
        COLOR_CONNECTION_LABEL_HALO,
        COLOR_BGRI_OUTLINE
    }, USE_POPULATION_HEATMAP);

    // Set the base fill expression in state so interactions.ts uses it
    appState.currentFillColorExpression = USE_POPULATION_HEATMAP
        ? POPULATION_DENSITY_EXPRESSION
        : COLOR_BGRI_FILL;

    // Initial visuals
    refreshVisuals();
};

if (map.loaded()) {
    initializeMap();
} else {
    map.on('load', initializeMap);
}

// Events
// Listen to clicks on the bgri-fill layer
map.on('click', 'bgri-fill', handleGridClick);

// Handle cursor pointer
map.on('mouseenter', 'bgri-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'bgri-fill', () => {
    map.getCanvas().style.cursor = '';
});

// Reset selection when clicking outside the interactive layer
map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['bgri-fill'] });
    if (!features.length) {
        resetSelection();
    }
});

// Calculate density when data is loaded
if (USE_POPULATION_HEATMAP) {
    let debounceTimer: number | null = null;
    map.on('data', (e) => {
        if (e.dataType !== 'source') return;
        // Listen to the heatmap/centroid source loading
        if (e.sourceId !== 'bgri-heatmap' || !e.isSourceLoaded) return;

        if (debounceTimer) window.clearTimeout(debounceTimer);

        debounceTimer = window.setTimeout(() => {
            // Query using the centroid source layer
            const features = map.querySourceFeatures('bgri-heatmap', {
                sourceLayer: SOURCE_LAYER_HEATMAP
            });

            features.forEach((feature) => {
                if (!feature.id) return;

                const individuals = feature.properties?.N_INDIVIDUOS;
                const areaM2 = feature.properties?.AREA_M2;

                if (
                    individuals !== undefined && individuals !== null &&
                    areaM2 !== undefined && areaM2 !== null && areaM2 > 0
                ) {
                    const density = individuals / areaM2;

                    // Apply state to the POLYGON source ('bgri') using the shared ID
                    map.setFeatureState(
                        { source: 'bgri', sourceLayer: SOURCE_LAYER_BGRI, id: feature.id },
                        { density: density }
                    );
                }
            });
        }, 500); // Debounce to avoid excessive calculation
    });
}
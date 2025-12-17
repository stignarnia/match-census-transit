import './style.css';
import Alpine from 'alpinejs';
import calendar from './calendar';
import { map } from './map';
import { setupMapLayers } from './layers';
import { appState } from './state';
import { handleGridClick, refreshVisuals, resetSelection } from './interactions';
import { area } from '@turf/turf';
import {
    COLOR_BEST,
    COLOR_WORST,
    COLOR_CENTROID_STROKE,
    COLOR_CONNECTION_BORDER,
    COLOR_CONNECTION_LABEL_TEXT,
    COLOR_CONNECTION_LABEL_HALO,
    COLOR_BGRI_FILL,
    COLOR_BGRI_OUTLINE,
    POPULATION_DENSITY_EXPRESSION
} from './constants';

const USE_POPULATION_HEATMAP = true;

Alpine.data('calendar', calendar);
Alpine.start();

// Time state
window.addEventListener('calendar-time-update', (e: Event) => {
    appState.latestCalendarTime = (e as CustomEvent).detail.date;
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
        ? POPULATION_DENSITY_EXPRESSION as any
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
        const event = e as mapboxgl.MapSourceDataEvent;
        if (event.sourceId !== 'bgri' || !event.isSourceLoaded) return;

        if (debounceTimer) window.clearTimeout(debounceTimer);

        debounceTimer = window.setTimeout(() => {
            const features = map.queryRenderedFeatures({ layers: ['bgri-fill'] });

            features.forEach((feature) => {
                if (!feature.id) return;

                const individuals = feature.properties?.N_INDIVIDUOS;
                if (individuals !== undefined && individuals !== null) {
                    // Turf area returns square meters
                    const polygonArea = area(feature);
                    // Density: Individuals per square meter
                    const density = individuals / polygonArea;

                    map.setFeatureState(
                        { source: 'bgri', sourceLayer: 'a8812bf3a307811dd19e', id: feature.id },
                        { density: density }
                    );
                }
            });
        }, 500); // Debounce to avoid excessive calculation
    });
}
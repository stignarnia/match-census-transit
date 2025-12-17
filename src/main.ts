import './style.css';
import Alpine from 'alpinejs';
import calendar, { type CalendarTimeUpdateEvent } from './calendar';
import people from './people';
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
    COLOR_BGRI_OUTLINE
} from './constants';

Alpine.data('calendar', calendar);
Alpine.data('people', people);
Alpine.start();

// Time state
window.addEventListener('calendar-time-update', (e: Event) => {
    const customEvent = e as CalendarTimeUpdateEvent;
    if (customEvent.detail && customEvent.detail.date) {
        appState.latestCalendarTime = customEvent.detail.date;
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
    });

    // Default state: 'Nothing' (Color by simple fill)
    appState.currentFillColorExpression = COLOR_BGRI_FILL;

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


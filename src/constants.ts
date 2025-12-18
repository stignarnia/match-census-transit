import type { ExpressionSpecification } from 'mapbox-gl';

// Color Palette
export const COLOR_BEST = '#10b981';
export const COLOR_WORST = '#ef4444';
export const COLOR_CENTROID_STROKE = '#ffffff';
export const COLOR_CONNECTION_BORDER = '#ffffff';
export const COLOR_CONNECTION_LABEL_TEXT = '#ffffff';
export const COLOR_CONNECTION_LABEL_HALO = '#000000';
export const COLOR_GRAY = '#9ca3af';
export const COLOR_SELECTION_FIRST = 'rgba(0, 255, 0, 0.8)';
export const COLOR_SELECTION_SECOND = 'rgba(255, 100, 100, 0.8)';
export const COLOR_BGRI_FILL = 'rgba(0, 81, 255, 0.3)';
export const COLOR_BGRI_OUTLINE = 'rgba(75, 131, 252, 0.3)';

// Color thresholds
export const THRESHOLD_BEST = 100;
export const THRESHOLD_WORST = 300;

export const POPULATION_DENSITY_EXPRESSION: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['coalesce', ['feature-state', 'density'], 0],
    0, 'rgba(33,102,172,0)',
    0.0002, 'rgb(103,169,207)',
    0.001, 'rgb(209,229,240)',
    0.005, 'rgb(253,219,199)',
    0.01, 'rgb(239,138,98)',
    0.02, 'rgb(178,24,43)'
];

// Mapbox Tileset Constants
export const TILESET_URL_HEATMAP = 'mapbox://stignarnia.ka74c554wsq4';
export const SOURCE_LAYER_HEATMAP = 'c56c767dc457b2f92e75';
export const TILESET_URL_BGRI = 'mapbox://stignarnia.fukjd3p5wied';
export const SOURCE_LAYER_BGRI = '34beff8bae5db5744e8f';

// Map Configuration
export const MAP_CENTER_LNG = -9.15;
export const MAP_CENTER_LAT = 38.72;

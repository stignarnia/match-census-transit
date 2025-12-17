import {
    POPULATION_DENSITY_EXPRESSION,
    TILESET_URL_HEATMAP,
    SOURCE_LAYER_HEATMAP,
    TILESET_URL_BGRI,
    SOURCE_LAYER_BGRI
} from './constants';

export interface LayerTheme {
    COLOR_BGRI_FILL: string;
    COLOR_BGRI_OUTLINE: string;
    COLOR_BEST: string;
    COLOR_CENTROID_STROKE: string;
    COLOR_WORST: string;
    COLOR_CONNECTION_BORDER: string;
    COLOR_CONNECTION_LABEL_TEXT: string;
    COLOR_CONNECTION_LABEL_HALO: string;
}

export function setupMapLayers(map: mapboxgl.Map, theme: LayerTheme) {
    // BGRI Heatmap (Zoom 0-11)
    map.addSource('bgri-heatmap', {
        type: 'vector',
        url: TILESET_URL_HEATMAP,
        promoteId: 'BGRI2021'
    });

    map.addLayer({
        id: 'bgri-heatmap-layer',
        type: 'heatmap',
        source: 'bgri-heatmap',
        'source-layer': SOURCE_LAYER_HEATMAP,
        maxzoom: 12,
        paint: {
            // Unchanged props
            'heatmap-opacity': 1,
            'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 2,
                11, 20
            ],
            // Color ramp
            'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0, 'rgba(33,102,172,0)',
                0.2, 'rgb(103,169,207)',
                0.4, 'rgb(209,229,240)',
                0.6, 'rgb(253,219,199)',
                0.8, 'rgb(239,138,98)',
                1, 'rgb(178,24,43)'
            ],
            // Default "Nothing" mode: standard heatmap behavior (points = 1)
            'heatmap-weight': 1,
            'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 1,
                11, 3
            ]
        }
    });

    // Hidden points layer for centroids (Zoom 12+)
    // We use feature-state to reveal selected points
    map.addLayer({
        id: 'bgri-points',
        type: 'circle',
        source: 'bgri-heatmap',
        'source-layer': SOURCE_LAYER_HEATMAP,
        minzoom: 12,
        paint: {
            'circle-radius': 8,
            'circle-stroke-width': 3,
            'circle-stroke-color': theme.COLOR_CENTROID_STROKE,
            'circle-emissive-strength': 1,
            // Opacity is 0 by default, 1 when selected
            'circle-opacity': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                1,
                0
            ],
            'circle-stroke-opacity': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                1,
                0
            ],
            // Color depends on selection type
            'circle-color': [
                'case',
                ['==', ['feature-state', 'selectionType'], 'first'],
                theme.COLOR_BEST,
                ['==', ['feature-state', 'selectionType'], 'second'],
                theme.COLOR_WORST,
                theme.COLOR_BEST // default fallback
            ]
        }
    });

    // BGRI Census Data (Underneath grid)
    map.addSource('bgri', {
        type: 'vector',
        url: TILESET_URL_BGRI,
        promoteId: 'BGRI2021' // Important for feature-state
    });

    map.addLayer({
        id: 'bgri-fill',
        type: 'fill',
        source: 'bgri',
        'source-layer': SOURCE_LAYER_BGRI,
        minzoom: 12,
        paint: {
            // Default fill color
            'fill-color': theme.COLOR_BGRI_FILL,
            'fill-outline-color': theme.COLOR_BGRI_OUTLINE,
            'fill-emissive-strength': 1
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

export function setMapVisualMode(map: mapboxgl.Map, mode: string, theme: LayerTheme) {
    // Mode: 'Nothing' (default) or 'Population density'

    if (mode === 'Population density') {
        // Heatmap: Weight by population
        map.setPaintProperty('bgri-heatmap-layer', 'heatmap-weight', [
            'interpolate',
            ['linear'],
            ['get', 'N_INDIVIDUOS'],
            0, 0,
            1000, 1
        ]);
        // Heatmap: Lower intensity
        map.setPaintProperty('bgri-heatmap-layer', 'heatmap-intensity', [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.1,
            11, 1
        ]);
        // Fill: Color by density
        map.setPaintProperty('bgri-fill', 'fill-color', POPULATION_DENSITY_EXPRESSION);

        return POPULATION_DENSITY_EXPRESSION;
    } else {
        // Default: 'Nothing'
        // Heatmap: Default weight
        map.setPaintProperty('bgri-heatmap-layer', 'heatmap-weight', 1);
        // Heatmap: Default intensity
        map.setPaintProperty('bgri-heatmap-layer', 'heatmap-intensity', [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            11, 3
        ]);
        // Fill: Default color
        map.setPaintProperty('bgri-fill', 'fill-color', theme.COLOR_BGRI_FILL);

        return theme.COLOR_BGRI_FILL;
    }
}
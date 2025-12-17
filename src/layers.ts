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
        url: 'mapbox://stignarnia.ka74c554wsq4',
        promoteId: 'BGRI2021'
    });

    map.addLayer({
        id: 'bgri-heatmap-layer',
        type: 'heatmap',
        source: 'bgri-heatmap',
        'source-layer': 'c921642b0ab40bb7d620',
        maxzoom: 12,
        paint: {
            // Increase the heatmap weight based on frequency and property magnitude
            'heatmap-weight': 1,
            // Increase the heatmap color weight weight by zoom level
            // heatmap-intensity is a multiplier on top of heatmap-weight
            'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 1,
                11, 3
            ],
            // Color ramp for heatmap.  Domain is 0 (low) to 1 (high).
            // Begin color ramp at 0-stop with a 0-transparency color
            // to create a blur-like effect.
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
            // Adjust the heatmap radius by zoom level
            'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 2,
                11, 20
            ],
            // Transition from heatmap to circle layer by zoom level
            'heatmap-opacity': 1
        }
    });

    // Hidden points layer for centroids (Zoom 12+)
    // We use feature-state to reveal selected points
    map.addLayer({
        id: 'bgri-points',
        type: 'circle',
        source: 'bgri-heatmap',
        'source-layer': 'c921642b0ab40bb7d620',
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
        url: 'mapbox://stignarnia.fukjd3p5wied'
    });

    map.addLayer({
        id: 'bgri-fill',
        type: 'fill',
        source: 'bgri',
        'source-layer': 'a8812bf3a307811dd19e',
        minzoom: 12,
        paint: {
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

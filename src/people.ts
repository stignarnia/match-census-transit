import { map } from './map';
import { appState } from './state';
import { refreshVisuals } from './interactions';
import {
    COLOR_BGRI_FILL,
    SOURCE_LAYER_HEATMAP,
    SOURCE_LAYER_BGRI,
    POPULATION_DENSITY_EXPRESSION,
    OLD_PEOPLE_RATIO_EXPRESSION
} from './constants';

export interface PeopleData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export default (): PeopleData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Population density', 'Old People Ratio'],

    init() {
        // Calculate density when data is loaded (Always doing this now to support switching)
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
                    const individuals65plus = feature.properties?.N_INDIVIDUOS_65_OU_MAIS;
                    const areaM2 = feature.properties?.AREA_M2;

                    const stateUpdates: any = {};

                    // Calculate Density
                    if (
                        individuals !== undefined && individuals !== null &&
                        areaM2 !== undefined && areaM2 !== null && areaM2 > 0
                    ) {
                        const density = individuals / areaM2;
                        stateUpdates.density = density;
                    }

                    // Calculate Old People Ratio
                    if (
                        individuals !== undefined && individuals !== null && individuals > 0 &&
                        individuals65plus !== undefined && individuals65plus !== null
                    ) {
                        const oldRatio = individuals65plus / individuals;
                        stateUpdates.old_ratio = oldRatio;
                    }

                    if (Object.keys(stateUpdates).length > 0) {
                        // Apply state to the POLYGON source ('bgri') using the shared ID
                        map.setFeatureState(
                            { source: 'bgri', sourceLayer: SOURCE_LAYER_BGRI, id: feature.id },
                            stateUpdates
                        );
                    }
                });
            }, 500); // Debounce to avoid excessive calculation
        });
    },

    select(option: string) {
        this.selected = option;

        // Visual Configuration Interface
        interface VisualConfig {
            fillColor: any;
            heatmapWeight: any;
            heatmapIntensity: any;
        }

        let config: VisualConfig | null = null;

        // Switch based implementation for metric handling
        switch (option) {
            case 'Nothing':
                config = {
                    fillColor: COLOR_BGRI_FILL,
                    heatmapWeight: 1,
                    heatmapIntensity: [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        0, 1,
                        11, 3
                    ]
                };
                break;

            case 'Population density':
                config = {
                    fillColor: POPULATION_DENSITY_EXPRESSION,
                    heatmapWeight: [
                        'interpolate',
                        ['linear'],
                        ['get', 'N_INDIVIDUOS'],
                        0, 0,
                        1000, 1
                    ],
                    heatmapIntensity: [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        0, 0.1,
                        11, 1
                    ]
                };
                break;

            case 'Old People Ratio':
                config = {
                    fillColor: OLD_PEOPLE_RATIO_EXPRESSION,
                    heatmapWeight: [
                        'interpolate',
                        ['linear'],
                        ['get', 'N_INDIVIDUOS_65_OU_MAIS'], // Weight by number of old people
                        0, 0,
                        1000, 1 // Adjust max value as needed
                    ],
                    heatmapIntensity: [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        0, 0.1,
                        11, 1
                    ]
                };
                break;
        }

        if (config) {
            // Apply Heatmap Settings
            map.setPaintProperty('bgri-heatmap-layer', 'heatmap-weight', config.heatmapWeight);
            map.setPaintProperty('bgri-heatmap-layer', 'heatmap-intensity', config.heatmapIntensity);

            // Apply Fill Color
            map.setPaintProperty('bgri-fill', 'fill-color', config.fillColor);

            // Update state so interactions use the correct fill logic
            appState.currentFillColorExpression = config.fillColor;
        }

        // Optionally refresh visuals to ensure consistency if a selection exists
        refreshVisuals();
    }
});

import { map } from './map';
import { appState } from './state';
import { setMapVisualMode } from './layers';
import { refreshVisuals } from './interactions';
import {
    COLOR_BGRI_FILL,
    COLOR_BEST,
    COLOR_CENTROID_STROKE,
    COLOR_WORST,
    COLOR_CONNECTION_BORDER,
    COLOR_CONNECTION_LABEL_TEXT,
    COLOR_CONNECTION_LABEL_HALO,
    COLOR_BGRI_OUTLINE,
    SOURCE_LAYER_HEATMAP,
    SOURCE_LAYER_BGRI
} from './constants';

export interface PeopleData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export default (): PeopleData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Population density'],

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
    },

    select(option: string) {
        this.selected = option;

        // Update map visuals using the new helper
        const activeFillExpression = setMapVisualMode(map, option, {
            COLOR_BGRI_FILL,
            COLOR_BEST,
            COLOR_CENTROID_STROKE,
            COLOR_WORST,
            COLOR_CONNECTION_BORDER,
            COLOR_CONNECTION_LABEL_TEXT,
            COLOR_CONNECTION_LABEL_HALO,
            COLOR_BGRI_OUTLINE
        });

        // Update state so interactions use the correct fill logic
        appState.currentFillColorExpression = activeFillExpression;

        // Optionally refresh visuals to ensure consistency if a selection exists
        refreshVisuals();
    }
});

import { map } from './map';
import { appState } from './state';
import { refreshVisuals } from './interactions';
import {
    COLOR_BGRI_FILL,
    SOURCE_LAYER_HEATMAP,
    SOURCE_LAYER_BGRI,
    POPULATION_DENSITY_EXPRESSION,
    OLD_PEOPLE_RATIO_EXPRESSION,
    YOUNG_PEOPLE_0_14_RATIO_EXPRESSION,
    YOUNG_PEOPLE_15_24_RATIO_EXPRESSION,
    YOUNG_PEOPLE_0_24_RATIO_EXPRESSION,
    TRANSIT_DENSITY_EXPRESSION
} from './constants';
import { createResponsiveState } from './responsiveness';

export interface PeopleData {
    selected: string;
    options: string[];
    expanded: boolean;
    weightByDensity: boolean;
    select(option: string): void;
    toggle(): void;
    toggleWeightByDensity(): void;
    initResponsive(): void;
    init(): void;
}

interface MetricConfig {
    id: string;
    calculate?: (props: any) => number | null;
    stateKey?: string;
    visualConfig: {
        fillColor: any;
        heatmapWeight: any;
        heatmapIntensity: any;
    };
}

const metrics: MetricConfig[] = [
    {
        id: 'Nothing',
        visualConfig: {
            fillColor: COLOR_BGRI_FILL,
            heatmapWeight: 1,
            heatmapIntensity: [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 1,
                11, 3
            ]
        }
    },
    {
        id: 'Population density',
        stateKey: 'density',
        calculate: (props: any) => {
            const individuals = props.N_INDIVIDUOS;
            const areaM2 = props.AREA_M2;
            if (
                individuals !== undefined && individuals !== null &&
                areaM2 !== undefined && areaM2 !== null && areaM2 > 0
            ) {
                return individuals / areaM2;
            }
            return null;
        },
        visualConfig: {
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
        }
    },
    {
        id: 'Old People Ratio',
        stateKey: 'old_ratio',
        calculate: (props: any) => {
            const individuals = props.N_INDIVIDUOS;
            const individuals65plus = props.N_INDIVIDUOS_65_OU_MAIS;
            if (
                individuals !== undefined && individuals !== null && individuals > 0 &&
                individuals65plus !== undefined && individuals65plus !== null
            ) {
                return individuals65plus / individuals;
            }
            return null;
        },
        visualConfig: {
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
        }
    },
    {
        id: 'Ages 0-14 Ratio',
        stateKey: 'young_0_14_ratio',
        calculate: (props: any) => {
            const individuals = props.N_INDIVIDUOS;
            const youngPeople = props.N_INDIVIDUOS_0_14 || 0;
            if (
                individuals !== undefined && individuals !== null && individuals > 0
            ) {
                return youngPeople / individuals;
            }
            return null;
        },
        visualConfig: {
            fillColor: YOUNG_PEOPLE_0_14_RATIO_EXPRESSION,
            heatmapWeight: [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'N_INDIVIDUOS_0_14'], 0],
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
        }
    },
    {
        id: 'Ages 15-24 Ratio',
        stateKey: 'young_15_24_ratio',
        calculate: (props: any) => {
            const individuals = props.N_INDIVIDUOS;
            const youngPeople = props.N_INDIVIDUOS_15_24 || 0;
            if (
                individuals !== undefined && individuals !== null && individuals > 0
            ) {
                return youngPeople / individuals;
            }
            return null;
        },
        visualConfig: {
            fillColor: YOUNG_PEOPLE_15_24_RATIO_EXPRESSION,
            heatmapWeight: [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'N_INDIVIDUOS_15_24'], 0],
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
        }
    },
    {
        id: 'Ages 0-24 Ratio',
        stateKey: 'young_0_24_ratio',
        calculate: (props: any) => {
            const individuals = props.N_INDIVIDUOS;
            const young0_14 = props.N_INDIVIDUOS_0_14 || 0;
            const young15_24 = props.N_INDIVIDUOS_15_24 || 0;
            const youngTotal = young0_14 + young15_24;
            if (
                individuals !== undefined && individuals !== null && individuals > 0
            ) {
                return youngTotal / individuals;
            }
            return null;
        },
        visualConfig: {
            fillColor: YOUNG_PEOPLE_0_24_RATIO_EXPRESSION,
            heatmapWeight: [
                'interpolate',
                ['linear'],
                ['get', 'N_INDIVIDUOS_0_14'],
                0, 0,
                1000, 0.5
            ],
            heatmapIntensity: [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 0.1,
                11, 1
            ]
        }
    },
    {
        id: 'Transit Density',
        stateKey: 'transit_density',
        calculate: (props: any) => {
            const val = props.TRANSIT_STOP_BY_FREQUENCIES;
            const areaM2 = props.AREA_M2;
            if (
                val !== undefined && val !== null &&
                areaM2 !== undefined && areaM2 !== null && areaM2 > 0
            ) {
                return val / areaM2;
            }
            return null;
        },
        visualConfig: {
            fillColor: TRANSIT_DENSITY_EXPRESSION,
            heatmapWeight: [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'TRANSIT_STOP_BY_FREQUENCIES'], 0],
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
        }
    }
];

export default (): PeopleData => ({
    ...createResponsiveState(),
    selected: 'Nothing',
    weightByDensity: false,
    options: metrics.map(m => m.id),

    toggleWeightByDensity() {
        this.weightByDensity = !this.weightByDensity;
        // Reapply the current selection to update visuals with new weighting
        this.select(this.selected);
    },

    init() {
        this.initResponsive();

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
                    if (!feature.id || !feature.properties) return;

                    const stateUpdates: any = {};

                    metrics.forEach(metric => {
                        if (metric.calculate && metric.stateKey) {
                            const val = metric.calculate(feature.properties);
                            if (val !== null) {
                                stateUpdates[metric.stateKey] = val;
                            }
                        }
                    });

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
        const metric = metrics.find(m => m.id === option);

        if (metric) {
            let config = metric.visualConfig;

            // If weight by density is enabled and this is a ratio metric, weight the fill color by density
            if (this.weightByDensity && metric.stateKey && (
                metric.stateKey.includes('ratio') || metric.stateKey === 'old_ratio'
            )) {
                // Apply density-weighted fill color expression
                // This multiplies the ratio by a density factor to reduce outliers in low-population areas
                const densityWeightedFillColor: any = [
                    'interpolate',
                    ['linear'],
                    [
                        '*',
                        ['coalesce', ['feature-state', metric.stateKey], 0],
                        [
                            'interpolate',
                            ['linear'],
                            ['coalesce', ['feature-state', 'density'], 0],
                            0, 0,
                            0.001, 0.3,
                            0.01, 1
                        ]
                    ],
                    0, 'rgba(33,102,172,0)',
                    0.01, 'rgb(103,169,207)',
                    0.04, 'rgb(209,229,240)',
                    0.08, 'rgb(253,219,199)',
                    0.12, 'rgb(239,138,98)',
                    0.20, 'rgb(178,24,43)'
                ];
                
                // Apply Fill Color with density weighting
                map.setPaintProperty('bgri-fill', 'fill-color', densityWeightedFillColor);
                appState.currentFillColorExpression = densityWeightedFillColor;
            } else {
                // Apply standard fill color
                map.setPaintProperty('bgri-fill', 'fill-color', config.fillColor);
                appState.currentFillColorExpression = config.fillColor;
            }

            // Apply Heatmap Settings
            map.setPaintProperty('bgri-heatmap-layer', 'heatmap-weight', config.heatmapWeight);
            map.setPaintProperty('bgri-heatmap-layer', 'heatmap-intensity', config.heatmapIntensity);
        }

        // Refresh visuals to ensure consistency if a selection exists
        refreshVisuals();
    }
});

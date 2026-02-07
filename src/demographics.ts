import { appState } from './state';
import { createResponsiveState } from './responsiveness';

export interface DemographicsData {
    expanded: boolean;
    toggle(): void;
    initResponsive(): void;
    init(): void;
    options: string[];
    appState: typeof appState;
    firstOriginTotalPopulation: number;
    firstOriginAge0_14: number;
    firstOriginAge15_24: number;
    firstOriginAge65Plus: number;
    firstOriginDensity: number;
    secondDestinationTotalPopulation: number;
    secondDestinationAge0_14: number;
    secondDestinationAge15_24: number;
    secondDestinationAge65Plus: number;
    secondDestinationDensity: number;
    updateDemographics(): void;
}

export default (): DemographicsData => ({
    ...createResponsiveState(),
    
    // Options array (required for panel template)
    options: [],
    
    // Expose appState for reactivity
    appState,
    
    // Reactive properties
    firstOriginTotalPopulation: 0,
    firstOriginAge0_14: 0,
    firstOriginAge15_24: 0,
    firstOriginAge65Plus: 0,
    firstOriginDensity: 0,
    secondDestinationTotalPopulation: 0,
    secondDestinationAge0_14: 0,
    secondDestinationAge15_24: 0,
    secondDestinationAge65Plus: 0,
    secondDestinationDensity: 0,
    
    // Update method to sync with appState
    updateDemographics() {
        // Use the demographic properties directly from the selected features
        // These should be in the Mapbox vector tile data, same as used for coloring
        
        if (appState.firstSelectionProperties) {
            const props = appState.firstSelectionProperties;
            this.firstOriginTotalPopulation = props.N_INDIVIDUOS ?? 0;
            this.firstOriginAge0_14 = props.N_INDIVIDUOS_0_14 ?? 0;
            this.firstOriginAge15_24 = props.N_INDIVIDUOS_15_24 ?? 0;
            this.firstOriginAge65Plus = props.N_INDIVIDUOS_65_OU_MAIS ?? 0;
            
            // Calculate density: people per km²
            const areaM2 = props.AREA_M2;
            if (areaM2 && areaM2 > 0) {
                this.firstOriginDensity = Math.round((this.firstOriginTotalPopulation * 1000000) / areaM2);
            } else {
                this.firstOriginDensity = 0;
            }
        } else {
            this.firstOriginTotalPopulation = 0;
            this.firstOriginAge0_14 = 0;
            this.firstOriginAge15_24 = 0;
            this.firstOriginAge65Plus = 0;
            this.firstOriginDensity = 0;
        }
        
        if (appState.secondSelectionProperties) {
            const props = appState.secondSelectionProperties;
            this.secondDestinationTotalPopulation = props.N_INDIVIDUOS ?? 0;
            this.secondDestinationAge0_14 = props.N_INDIVIDUOS_0_14 ?? 0;
            this.secondDestinationAge15_24 = props.N_INDIVIDUOS_15_24 ?? 0;
            this.secondDestinationAge65Plus = props.N_INDIVIDUOS_65_OU_MAIS ?? 0;
            
            // Calculate density: people per km²
            const areaM2 = props.AREA_M2;
            if (areaM2 && areaM2 > 0) {
                this.secondDestinationDensity = Math.round((this.secondDestinationTotalPopulation * 1000000) / areaM2);
            } else {
                this.secondDestinationDensity = 0;
            }
        } else {
            this.secondDestinationTotalPopulation = 0;
            this.secondDestinationAge0_14 = 0;
            this.secondDestinationAge15_24 = 0;
            this.secondDestinationAge65Plus = 0;
            this.secondDestinationDensity = 0;
        }
    },

    init() {
        this.initResponsive();
        // Register this component globally for updates from interactions.ts
        (window as any).demographicsComponent = this;
        // Initial update
        this.updateDemographics();
    }
});

import { map } from './map';
import { fetchNearbyPlaces } from './google-places';

export interface PlacesData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export function setupPlacesLayers(map: mapboxgl.Map) {
    if (map.getSource('places-source')) return;

    map.addSource('places-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'places-layer',
        type: 'circle',
        source: 'places-source',
        paint: {
            // Emissive strength to match other layers
            'circle-emissive-strength': 1,

            // Interpolate radius by zoom
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 2,
                11, 6,
                14, 12
            ],

            // White center for visibility
            'circle-color': '#ffffff',

            // Stroke width
            'circle-stroke-width': 2,

            // Dynamic stroke color based on type
            'circle-stroke-color': [
                'match',
                ['get', 'place_type'],
                'hospital', '#ef4444', // Red-ish
                'school', '#06b6d4',   // Cyan-ish
                '#9ca3af'              // Gray default
            ]
        }
    });
}

export default (): PlacesData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Hospitals', 'Schools'],

    init() {
        // Ensure layers are setup when map is loaded
        if (map.loaded()) {
            setupPlacesLayers(map);
        } else {
            map.on('load', () => setupPlacesLayers(map));
        }
    },

    async select(option: string) {
        this.selected = option;

        // Ensure layers exist
        setupPlacesLayers(map);
        const source = map.getSource('places-source') as mapboxgl.GeoJSONSource;
        if (!source) return;

        switch (option) {
            case 'Nothing':
                source.setData({ type: 'FeatureCollection', features: [] });
                break;
            case 'Hospitals':
                const hospitals = await fetchNearbyPlaces('hospital');
                source.setData(hospitals);
                break;
            case 'Schools':
                const schools = await fetchNearbyPlaces('school');
                source.setData(schools);
                break;
            default:
                break;
        }
    }
});

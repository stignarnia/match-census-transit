import { map } from './map';
import hospitalData from './assets/hospital.json';
import schoolData from './assets/secondary_school.json';
import googleMapPin from './assets/Google_Maps_pin.png';

export interface PlacesData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export default (): PlacesData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Hospitals', 'Schools'],

    init() {
        // Placeholder
    },

    async select(option: string) {
        this.selected = option;
        const currentSourceId = 'places-source';
        const currentLayerId = 'places-layer';

        const clearMap = () => {
            if (map.getLayer(currentLayerId)) map.removeLayer(currentLayerId);
            if (map.getSource(currentSourceId)) map.removeSource(currentSourceId);
        };

        clearMap();

        let data: any = null;
        switch (option) {
            case 'Nothing':
                break;
            case 'Hospitals':
                data = hospitalData;
                break;
            case 'Schools':
                data = schoolData;
                break;
        }

        if (data) {
            const iconId = 'google-maps-pin';
            if (!map.hasImage(iconId)) {
                try {
                    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                        map.loadImage(googleMapPin, (error, image) => {
                            if (error) reject(error);
                            else resolve(image as HTMLImageElement);
                        });
                    });
                    if (!map.hasImage(iconId)) map.addImage(iconId, image);
                } catch (error) {
                    console.error('Failed to load icon:', error);
                    return;
                }
            }

            map.addSource(currentSourceId, {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: currentLayerId,
                type: 'symbol',
                source: currentSourceId,
                layout: {
                    'icon-image': iconId,
                    'icon-size': [
                        'interpolate', ['linear'], ['zoom'],
                        15, 0.05
                    ],
                    'icon-allow-overlap': true,
                    'icon-anchor': 'bottom'
                }
            });
        }
    }
});

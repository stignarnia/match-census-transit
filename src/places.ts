import { map } from './map';
import hospitalData from './assets/hospital.json';
import schoolData from './assets/secondary_school.json';
import googleMapPin from './assets/Google_Maps_pin.png';
import mapboxgl from 'mapbox-gl';

export interface PlacesData {
    selected: string;
    options: string[];
    activePopup: mapboxgl.Popup | null;
    select(option: string): void;
    init(): void;
}

export default (): PlacesData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Hospitals', 'Schools'],
    activePopup: null,

    init() {
        // Handle Map Click for Tooltip
        map.on('click', 'places-layer', (e) => {
            e.preventDefault(); // Prevent map click (selection)
            if (!e.features || !e.features.length) return;

            const feature = e.features[0];
            const props = feature.properties;
            if (!props) return;

            // Close existing popup
            if (this.activePopup) {
                this.activePopup.remove();
            }

            // Create Content
            const container = document.createElement('div');
            container.className = 'w-64 flex flex-col gap-2 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 p-4 rounded-2xl shadow-2xl text-white font-sans select-none';

            // Close Button
            const closeBtn = document.createElement('button');
            closeBtn.className = 'absolute top-3 right-3 text-zinc-400 hover:text-white transition-colors';
            closeBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            `;
            closeBtn.onclick = () => {
                if (this.activePopup) this.activePopup.remove();
            };
            container.appendChild(closeBtn);

            // Header
            const header = document.createElement('div');
            header.className = 'pr-6';

            const category = document.createElement('div');
            category.className = 'text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-0.5';
            category.innerText = (props.harvest_category || 'Place').replace(/_/g, ' ');
            header.appendChild(category);

            const title = document.createElement('div');
            title.className = 'text-sm font-bold text-white leading-tight';
            title.innerText = props.name || 'Unknown Name';
            header.appendChild(title);

            container.appendChild(header);

            // Body
            if (props.address) {
                const body = document.createElement('div');
                body.className = 'text-xs text-zinc-400 bg-zinc-950/50 p-2 rounded-lg border border-zinc-800/50';
                body.innerText = props.address;
                container.appendChild(body);
            }

            // Popup
            this.activePopup = new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: 'unified-popup',
                maxWidth: 'none'
            })
                .setLngLat(feature.geometry.type === 'Point' ? (feature.geometry as any).coordinates : e.lngLat)
                .setDOMContent(container)
                .addTo(map);

            // Cleanup on close
            this.activePopup.on('close', () => {
                this.activePopup = null;
            });
        });

        // Change cursor
        map.on('mouseenter', 'places-layer', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'places-layer', () => {
            map.getCanvas().style.cursor = '';
        });

        // ESC Listener specific for popup
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activePopup) {
                this.activePopup.remove();
            }
        });
    },

    async select(option: string) {
        this.selected = option;

        // Close popup when switching selection
        if (this.activePopup) {
            this.activePopup.remove();
        }

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

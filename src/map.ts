import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

export const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/standard',
    config: {
        basemap: {
            lightPreset: "night"
        }
    },
    center: [-9.15, 38.72],
    zoom: 12
});

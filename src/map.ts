import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

export const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/standard',
    config: {
        basemap: {
            lightPreset: "night",
            showPointOfInterestLabels: false,
            show3dObjects: false,
            show3dBuildings: false,
            show3dTrees: false,
            show3dLandmarks: false,
            showLandmarkIconLabels: false
        }
    },
    center: [-9.15, 38.72],
    zoom: 12
});

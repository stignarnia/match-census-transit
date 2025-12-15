import './style.css'
import mapboxgl from 'mapbox-gl';
import Alpine from 'alpinejs'
import { generateGridFeatures, LISBON_BBOX } from './grid-logic';
import type { FeatureCollection } from 'geojson';

window.Alpine = Alpine
Alpine.start()

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-9.15, 38.72],
    zoom: 10
});



let selectedSquare: string | null = null;

map.on('load', () => {
    map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
        id: 'grid-fill', type: 'fill', source: 'grid',
        paint: {
            'fill-color': ['case', ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)', 'rgba(0, 100, 200, 0.3)'],
            'fill-outline-color': 'rgba(0, 100, 200, 0.5)'
        }
    });

    map.addLayer({
        id: 'grid-labels', type: 'symbol', source: 'grid',
        layout: { 'text-field': ['get', 'id'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': 'white', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1 }
    });

    updateGrid();
});

map.on('moveend', updateGrid);
map.on('click', 'grid-fill', (e) => {
    const f = e.features?.[0];
    if (f) {
        selectedSquare = selectedSquare === f.properties?.id ? null : f.properties?.id;
        map.setPaintProperty('grid-fill', 'fill-color', ['case', ['==', ['get', 'id'], selectedSquare || ''], 'rgba(255, 100, 100, 0.8)', 'rgba(0, 100, 200, 0.3)']);
    }
});

function updateGrid() {
    const zoom = map.getZoom();
    const bounds = map.getBounds()!;

    // Intersect viewport with grid bounds
    const viewWest = Math.max(bounds.getWest(), LISBON_BBOX[0]);
    const viewSouth = Math.max(bounds.getSouth(), LISBON_BBOX[1]);
    const viewEast = Math.min(bounds.getEast(), LISBON_BBOX[2]);
    const viewNorth = Math.min(bounds.getNorth(), LISBON_BBOX[3]);

    if (viewWest >= viewEast || viewSouth >= viewNorth) {
        return setGrid({ type: 'FeatureCollection', features: [] });
    }

    const features = generateGridFeatures([viewWest, viewSouth, viewEast, viewNorth], zoom);
    setGrid({ type: 'FeatureCollection', features });
}

function setGrid(data: FeatureCollection) {
    (map.getSource('grid') as mapboxgl.GeoJSONSource)?.setData(data);
}


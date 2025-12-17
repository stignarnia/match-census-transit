import type { Feature, FeatureCollection } from 'geojson';
import { centroid, union } from '@turf/turf';

// Helper to get centroid for a grid feature, stitching parts if split by tiles
export function getFeatureCentroid(map: mapboxgl.Map, feature: Feature, id: string): { lng: number; lat: number } {
    let geometry = feature.geometry;

    // Try to find all visible parts of this feature (in case it's split by tile boundaries)
    const relatedFeatures = map.queryRenderedFeatures({
        layers: ['bgri-fill'],
        filter: ['==', ['get', 'BGRI2021'], id]
    });

    // If we found multiple pieces (and at least 2), merge them
    if (relatedFeatures.length > 1) {
        try {
            // Turf v7 union takes a FeatureCollection
            const collection = {
                type: 'FeatureCollection',
                features: relatedFeatures
            } as FeatureCollection<any>;

            const u = union(collection);
            if (u) geometry = u.geometry;
        } catch (e) {
            console.warn('Union failed, falling back to simple centroid', e);
        }
    }

    const centerPoint = centroid({ type: 'Feature', properties: {}, geometry });
    const coords = centerPoint.geometry.coordinates as [number, number];
    return { lng: coords[0], lat: coords[1] };
}

// Duration parsing
export function parseDurationSeconds(duration?: string | null): number {
    if (!duration) return 0;
    const seconds = parseInt(duration.replace('s', ''), 10);
    return Number.isFinite(seconds) ? seconds : 0;
}

export function interpolateColor(color1: string, color2: string, factor: number): string {
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);

    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);

    const r = Math.round(r1 + factor * (r2 - r1));
    const g = Math.round(g1 + factor * (g2 - g1));
    const b = Math.round(b1 + factor * (b2 - b1));

    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Convenience source getter
export function getGeoJSONSource(map: mapboxgl.Map, id: string): mapboxgl.GeoJSONSource | null {
    const source = map.getSource(id);
    return source ? (source as mapboxgl.GeoJSONSource) : null;
}

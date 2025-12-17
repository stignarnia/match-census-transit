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

/// <reference types="vite/client" />

interface Window {
    Alpine: typeof import('alpinejs')['default'];
}

interface ImportMetaEnv {
    readonly VITE_MAPBOX_ACCESS_TOKEN: string
    readonly VITE_GOOGLE_MAPS_API_KEY: string
    readonly VITE_TILESET_URL_HEATMAP: string
    readonly VITE_SOURCE_LAYER_HEATMAP: string
    readonly VITE_TILESET_URL_BGRI: string
    readonly VITE_SOURCE_LAYER_BGRI: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

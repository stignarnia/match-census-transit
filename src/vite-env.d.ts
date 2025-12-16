/// <reference types="vite/client" />

interface Window {
    Alpine: typeof import('alpinejs')['default'];
}

interface ImportMetaEnv {
    readonly VITE_MAPBOX_ACCESS_TOKEN: string
    readonly VITE_GOOGLE_MAPS_API_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

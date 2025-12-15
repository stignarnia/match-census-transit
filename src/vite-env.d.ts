/// <reference types="vite/client" />

interface Window {
    Alpine: typeof import('alpinejs')['default'];
}

interface ImportMetaEnv {
    readonly VITE_MAPBOX_ACCESS_TOKEN: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

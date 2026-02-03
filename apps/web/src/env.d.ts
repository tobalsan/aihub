/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIHUB_DEV?: string;
  readonly VITE_AIHUB_UI_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

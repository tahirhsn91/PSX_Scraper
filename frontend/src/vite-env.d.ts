/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** 'true' forces the dev banner on in a production build (staging label). */
  readonly VITE_SHOW_ENV_BANNER?: string;
  /** Overrides the banner text; defaults to 'DEVELOPMENT ENVIRONMENT'. */
  readonly VITE_ENV_LABEL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

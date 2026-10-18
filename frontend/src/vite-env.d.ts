/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** localStorage key the admin token is kept under; defaults to 'psx:admin-token'. */
  readonly VITE_ADMIN_TOKEN_KEY?: string;
  /** 'true' forces the dev banner on in a production build (staging label). */
  readonly VITE_SHOW_ENV_BANNER?: string;
  /** Overrides the banner text; defaults to 'DEVELOPMENT ENVIRONMENT'. */
  readonly VITE_ENV_LABEL?: string;
  /** Where the "Track your portfolio" header button points; defaults to the live manager. */
  readonly VITE_PORTFOLIO_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

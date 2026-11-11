/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_AGENT_URL?: string;
  readonly VITE_PAYMENTS_URL?: string;
  readonly VITE_ALLOW_DIRECT_CAPTURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

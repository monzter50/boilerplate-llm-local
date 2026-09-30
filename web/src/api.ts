import { createClient } from "@ia-local/sdk";

// Same origin as the UI: Vite proxies /api to the API server (vite.config.ts).
export const api = createClient({ baseUrl: "/api" });

declare module "*.css";

// The one Vite build flag the UI reads.
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}

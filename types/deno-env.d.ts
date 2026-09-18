// Minimal Deno runtime declarations so backend function entry points
// (source.ts + bundled index.ts) can be type-checked with the platform's
// typescript toolchain. This is a CHECK-ONLY stub — never imported by the app.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

// Backend functions import their dependencies from esm.sh at runtime.
declare module "https://*";

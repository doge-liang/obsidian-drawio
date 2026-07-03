// Minimal runtime stub for the 'obsidian' package (which ships types only, so
// Vite cannot resolve it in tests). Aliased in vitest.config.ts. Add exports
// here as tested modules need them.
export class Notice {
  constructor(_message?: string, _timeout?: number) {}
}

export class TFolder {
  path = '';
  name = '';
}

// Always report the newer API as available in tests; no test exercises the
// pre-1.4.0 fallback path.
export function requireApiVersion(_version: string): boolean {
  return true;
}

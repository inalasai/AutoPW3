# API route handlers

**Status:** `tesla.ts` reuses connect and callback logic for the separate staging-only read-only OAuth slice. `completeTeslaAuthorization` depends only on narrow actor authorization/persistence capabilities, never a privileged generic repository. The legacy wrapper remains for explicit local/test execution. Other incomplete routes and production remain blocked by `lib/app.ts`; route functions alone do not constitute deployed capabilities.

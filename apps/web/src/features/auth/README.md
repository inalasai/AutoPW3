# auth

Status: staging discovery recognizes only contract-validated, bounded Tesla recovery identifiers.
These preserve Supabase login; arbitrary error text is discarded. No browser token is exposed to UI.

Status: explicit manual read-only OAuth initiation is wired through the existing authenticated endpoint.
It validates the Tesla redirect and cannot run automatically on a recovery error.

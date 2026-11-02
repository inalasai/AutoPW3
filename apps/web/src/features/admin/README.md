# admin

Status: Tesla setup stops rediscovery on REAUTH/uncertain recovery and disables staging Powerwall
controls. Linking retains its idempotency key after ambiguous responses; persistence is server-owned.

Status: explicit manual read-only OAuth initiation is wired through the existing authenticated endpoint.
It validates the Tesla redirect and cannot run automatically on a recovery error.

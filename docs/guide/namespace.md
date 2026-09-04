# Namespace (Advanced)

Namespaces isolate sessions, machines, and users on a shared HAPI hub. Each account has a `defaultNamespace`; every API token created for that account is bound to that namespace.

This is not a default setup path for most users.

## How it works

- Each account in the multi-user gateway has a `defaultNamespace` (e.g. `default`, `alice`).
- Each API token created for an account inherits the account's namespace as a stored attribute.
- When authenticating via `POST /api/auth`, the entire `accessToken` string is hashed and looked up. The namespace is read from the matched token's stored attribute — **not** parsed from a suffix in the submitted token.
- Submitting `token:namespace` (appending `:<namespace>` to the token) always fails with `401 Invalid username or password`, because the full string (including the suffix) is hashed and no token with that hash exists.

## Token types

Two token types are accepted by `POST /api/auth`:

1. **Seed token** (`CLI_API_TOKEN`): on first hub start, the base `CLI_API_TOKEN` from `~/.hapi/settings.json` or the `CLI_API_TOKEN` env var is imported as a token on the admin account (stored with name `legacy bootstrap token`, namespace `default`). The bare `CLI_API_TOKEN` value can be submitted as `accessToken` without any suffix.
2. **Per-account API tokens** (`hapi_mu_*`): created via `POST /api/tokens` with an authenticated JWT. The plaintext is returned once (`hapi_mu_<base64url>`); only its sha256 hash is stored. The token's namespace is the creating account's `defaultNamespace`.

## Setup

1. The hub's `CLI_API_TOKEN` (env or `~/.hapi/settings.json`) seeds the admin account on first start. Use the bare value for admin access.

2. For additional users, an admin creates accounts (each with its own `defaultNamespace`), and each user creates their own `hapi_mu_*` tokens via the web UI (Settings → My API Token) or `POST /api/tokens`.

3. Tokens are per-account and per-namespace. There is no `base:namespace` suffix syntax.

## Limitations and gotchas

- `CLI_API_TOKEN` must not include `:<namespace>`. The hub validates the token from both the environment variable and `settings.json`, and refuses to start with an error if a suffix is present.
- Namespaces are isolated: sessions, machines, and users are not visible across namespaces.
- One machine ID cannot be reused across namespaces.
  - To run multiple namespaces on one machine, use a separate `HAPI_HOME` per namespace, or clear the machine ID with `hapi auth logout` before switching.
- Remote spawn is namespace-scoped. If you need remote spawning for multiple namespaces on the same machine, run a separate runner per namespace (use separate `HAPI_HOME`).

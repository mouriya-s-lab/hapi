---
alwaysApply: true
---

# HAPI 生产 hub 登录 token：从哪拿、怎么用

本仓库是 `tiann/hapi` 的 rebase-style fork，生产 hub（`hapi.237575.xyz`）的 `POST /api/auth` 实际由 multi-user gateway（`fork-features/multi-user/gatewayRoutes.ts`）处理，而非上游 `hub/src/web/routes/auth.ts`。gateway 在 `server.ts:266` 先于上游 auth route（`296`）挂载到 `/api`，上游的 `parseAccessToken` 冒号拆分逻辑不执行。所以上游文档遗留的 `CLI_API_TOKEN:namespace` 后缀语法在本 fork 中不生效——加了后缀必 401。

## 两种 token，都能登录（2026-08-16 生产实测）

1. **Seed token（CLI_API_TOKEN）** — admin 用，最直接。来源：`~/.hapi/settings.json` 的 `cliApiToken` 字段，或 `CLI_API_TOKEN` 环境变量。用法：`POST /api/auth {"accessToken":"<bare CLI_API_TOKEN>"}` → 200 + JWT。首次启动时 `hubMount.ts:102` 把它 sha256 hash 后存入 gateway sqlite 的 admin 账号（name=`legacy bootstrap token`, namespace=`default`），整个 accessToken 字符串做 sha256 后查库匹配。

2. **`hapi_mu_*` token** — 每账号独立。来源：web UI → Settings → 我的 API Token，或 `POST /api/tokens`（需已认证 JWT）。明文只在创建时返回一次，之后只存 sha256 hash。用法：`POST /api/auth {"accessToken":"hapi_mu_xxxx"}` → 200 + JWT。

## 登录步骤

1. 读 `~/.hapi/settings.json` 的 `cliApiToken` 字段
2. `curl -X POST https://hapi.237575.xyz/api/auth -H 'content-type: application/json' -d '{"accessToken":"<token>"}'`
3. 拿返回的 JWT 作为 `Authorization: Bearer <jwt>` 调用所有 `/api/*` 接口
4. JWT 约 4 小时过期，过期后重新 POST `/api/auth` 换新 JWT

## 禁止

- 加 `:namespace` 后缀。`token:default`、`token:alice` 等 `base:namespace` 形式一律 401——fork 的 `getActiveTokenByHash` 把整个字符串 hash 后查库，不解析冒号后缀。
- 用 username/password 登录，除非 token 路径完全不可用。admin 默认 `admin`/`admin` 能登录，但 token 是 agent 的正确路径。
- 把 token 明文留在对话或 transcript 里。拿到 JWT 后用它调接口，不回显 token 本身。

---
alwaysApply: true
---

# hapi fork 的发布部署编排：合并后先问 CD，再打 tag，由 Deployment 通知 workload owner

本仓库是 `tiann/hapi` 的 rebase-style fork（origin=`mouriya-s-lab/hapi`，upstream=`tiann/hapi`）。homelab 上的 hapi 是 km app：Stack `hapi` 声明在 `mouriya-s-lab/homelab-apps`（`komodo/syncs/stacks.toml`、`stacks/hapi/compose.yaml`），镜像为 `registry.237575.xyz/hapi/hub:stable`。**代码合并进 main ≠ 已上线**——中间隔着发布、镜像推送、GitHub Deployment 通知与 workload owner 部署。

这条 rule 只编排本仓库「代码已在 main → 怎么送上 homelab」的出口流程，并在每一步路由到既有 skill/rule。

## 触发时机

当本仓库有 PR 合并进 `main`、或 `main` 上积累了**尚未部署**的 runtime 改动时，适用本 rule。

- **runtime 改动** = 会进镜像 / 影响 hub·cli·web·shared 运行行为的改动 → 适用。
- **非 runtime 改动** = 只动 `.github/`、`docs/`、`website/`、README 等 → 不触发 CD 询问。

## 流程

### 1. 合并后主动问一次「是否现在 CD」

有 runtime 改动落到 main 后，在正文用自然语言问 operator 是否现在部署到 hapi 主入口（`hapi.237575.xyz` / homelab `hapi` Stack）。部署时机由 operator 定。

### 2. 要 CD → 打 tag 触发发布（不手 build）

- 版本约定：`vX.Y.Z-fork.N`。`X.Y.Z` = 当前 `cli/package.json` 的 `version`；`N` = 该 base 上的第几次 fork 发布，从 `0` 起递增。
- tag 打在要发布的 `main` commit 上，push 到 `origin`。`release.yml` 发布二进制；它成功后 `publish-image.yml` 用同一产物构建镜像，先推不可变 `<tag>`，再移动 `stable`，通过 digest 与拉取校验后，用本 repo 的 `GITHUB_TOKEN`（`deployments: write`）创建 GitHub Deployment：`environment=hapi`、`auto_merge=false`、`required_contexts=[]`、`ref` 为实际发布 checkout 的 commit SHA。
- 本 repo 只订阅 `deployment` 事件的 hook 通知 `homelab-apps` 拥有的 Procedure `deploy-hapi`；部署在 owner 侧异步执行。本 repo 不持有 Komodo 凭据，也不调用或轮询 Core API（[hapi#340](https://github.com/mouriya-s-lab/hapi/issues/340)）。
- workflow 由操作员停用时，不自行启用或绕过发布流程；只有操作员重新启用后才按本节发布。
- 账号保持 RiriAgent（`gh-account-routing`）。

### 3. 等流水线部署完并验证

- 不开 IaC issue，不改 homelab-tf。`publish-image.yml` 的 Deployment 步骤成功只说明 GitHub 接受了部署通知，不代表 owner 已完成部署；不靠 `auto_update`，因为私有镜像 digest 查询不带 Stack 的 registry 账号（[hapi#77](https://github.com/mouriya-s-lab/hapi/issues/77)）。Stack 保持 `auto_pull=true`，由 owner Procedure 拉取 `stable`。
- 等发布 CI 全绿，再用 `km` skill 读回 `deploy-hapi` 及其 Stack 部署 Update 的成功终态、Stack `hapi` 的运行镜像 digest 与新 tag 一致，并经真实入口验证新版本行为（`runtime-verification-required`）。
- 若部署因 Stack busy 失败，在 GitHub 重投该 Deployment 的 delivery；需要手动部署时直接部署 Stack，不手动执行 Procedure。
- 部署出问题：在 `homelab-apps` 开 issue 处理 Stack 声明；compose、卷、端口、tunnel connector 的改动都在 `homelab-apps`，不在本仓库，也不在 IaC。

### 4. 收尾

若这次更新改变了主入口背后的 hub，本机 Mac runner（launchd `xyz.237575.hapi-runner-macos`）可能要重启以重连新 hub——这步在本机做。

## 本规则禁止

- 把「PR 合并了」当成「已上线」而不问 CD。
- 跳过发布、手 build 镜像塞给部署。
- 为 hapi 版本更新开 `iac:deploy` issue 或改 homelab-tf。

## 与其他规则/skill 的边界

- `fork-upstream-sync`：管入口（从 upstream 拉代码）；本 rule 管出口。
- `km`：Stack 读回、排障与有界重试。
- `runtime-verification-required`：上线后的验证标准。
- `github-issue-pr-routing` / `writing-pr` / `writing-issue`：PR/issue 规范。

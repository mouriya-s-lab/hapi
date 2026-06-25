# hapi fork 的发布→部署编排：合并后先问 CD，再打 tag→等产物→开 IaC 任务

本仓库是 `tiann/hapi` 的 rebase-style fork（origin=`mouriya-s-lab/hapi`，upstream=`tiann/hapi`）。homelab 上的 hapi 部署跑的是**钉死版本的预编译 fork 二进制**，不是 main HEAD。所以**代码合并进 main ≠ 已上线**——中间隔着「发 Release → 改 compose pin → IaC apply」三道关。

这条 rule 只编排本仓库特有的「代码已在 main → 怎么把它送上 homelab 部署」这一段出口流程，并在每一步**路由到既有 skill/rule**。它**不复制**那些 skill/rule 的内容（见末尾「与其他规则/skill 的边界」）。

## 触发时机

当本仓库有 PR 合并进 `main`、或 `main` 上积累了**尚未部署**的 runtime 改动时，适用本 rule。

- **runtime 改动** = 会进编译二进制 / 影响 hub·cli·web·shared 运行行为的改动 → 适用。
- **非 runtime 改动** = 只动 `.github/`、`docs/`、`website/`、README 等不进二进制的东西 → 不触发 CD 询问，跳过本 rule。

## 流程（每步只指方向，细节归既有 skill）

### 1. 合并后必须主动问一次「是否现在 CD」

PR 合并不要默认「已生效」，也不要默认「自动部署」。有 runtime 改动落到 main 后，**主动问 operator**：这批改动是否现在部署到 hapi 主入口（`hapi.237575.xyz` / homelab `hapi` 栈），以及/或 fork 旁路（`hapi-fork.237575.xyz` / `hapi-fork` 栈）。

- 这是少数**值得问**的决策（部署有 blast radius，时机由 operator 定），不违反 `no-pointless-questions`。
- 问法走正文自然语言（`no-ask-user-question-tool`）。

### 2. 要 CD → 打 tag 触发 Release（不手 build）

- 版本约定：`vX.Y.Z-fork.N`。`X.Y.Z` = 当前 `cli/package.json` 的 `version`；`N` = 该 base 上的第几次 fork 发布，从 `0` 起递增。
- tag 打在要发布的 `main` commit 上，push 到 `origin` 触发 `.github/workflows/release.yml`（`on: push: tags: v*`，跑 `bun run build:single-exe:all`）。
- 账号保持 RiriAgent（`gh-account-routing`）。

### 3. 等编译产物 + 取 pin（产物没出/CI 没绿前不许进下一步）

- 等 Release CI 全绿后，从该 Release 取 homelab 部署需要的 `hapi-linux-x64-baseline.tar.gz`：**下载 URL** + 它在 `checksums.txt` 里的 **sha256**。
- 这两个值是下一步 IaC issue 的 compose pin。**没有产物就去开 iac:deploy = 开了张空头支票**，部署 agent 拿不到可钉的 URL/sha256。

### 4. 用既有 skill 开 IaC 部署任务

- 用 `iac-auto-deploy-issue` skill，在 **`mouriya-s-lab/homelab-tf`** 开 `iac:deploy` issue（注意：实际 owner 是 `mouriya-s-lab`，不是部分 skill/inventory 里写的 `Mouriya-Emma`）。
- 把第 3 步的 URL + sha256 写成执行契约里的 compose pin。默认部署形态 = **版本更新 / 原地换芯**：改 `komodo/roles/komodo-stacks/templates/{hapi,hapi-fork}/compose.yaml.j2` 的下载 pin，**保持卷 / 端口 / connector·token / tunnel / DNS 不变**。
- hapi 是 tunnel·session 单例：issue 的验收标准里**必须**含 stop-before-start、以及切换前备份 `hapi-data` 的检查项（怎么写归 iac-auto-deploy-issue skill，这里只提醒别漏）。

### 5. 收尾（不属于 IaC issue 的部分）

- 若这次 CD 改变了 hapi 主入口背后的 hub，本机 Mac runner（launchd `xyz.237575.hapi-runner-macos`）可能要重启以重连新 hub —— 这步**在本机做**，不写进 homelab-tf issue。是否需要由「这次部署是否动了主入口 hub」决定。

## 本规则禁止

- 把「PR 合并了」当成「已上线」而不问 CD（hapi 部署钉死在预编译二进制版本上，main 合并不会自动生效）。
- 跳过 Release、手 build 二进制塞给部署。
- 在产物未发布 / CI 未绿时就去开 `iac:deploy` issue（无可钉 pin）。
- 把 IaC issue 开到 `Mouriya-Emma/homelab-tf`（旧 owner）。

## 与其他规则/skill 的边界（明确不重复谁）

- `fork-upstream-sync`：管**入口**（从 upstream 拉代码进 fork）；本 rule 管**出口**（把 fork 代码送上部署）。互补，不重叠。
- `iac-auto-deploy-issue` / `iac-issue-routing` / `iac-projects` / `internal-services`：issue 怎么写、IaC 边界、owning repo、服务清单归它们；本 rule 只负责「**什么时候、带着什么产物**去触发它们」。
- `runtime-verification-required`：部署完成的验证标准归它和 IaC issue 的验收表；本 rule 不另立验证标准。
- `github-issue-pr-routing` / `writing-pr` / `writing-issue`：PR/issue 语义与正文规范归它们。

## 为什么单独存在

本仓库的特殊性是「**合并 ≠ 上线**」，且发布物是钉死的预编译 fork 二进制。没有这条编排，最常见两种错：(a) 合并后以为生效了，实际 `hapi.237575.xyz` 还跑旧版本；(b) 直接去开 `iac:deploy` 却没有对应 Release 产物，部署 agent 没有可钉的 URL/sha256。这条 rule 把「**先问是否 CD → 出产物 → 再开 IaC 任务**」的顺序钉死，并把每一步引到已存在的 skill/rule，而不重写它们。

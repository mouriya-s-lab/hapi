# CLAUDE.md — hapi fork 工作纪律

仓库事实（架构 / 目录 / 命令 / 代码风格）见 **`AGENTS.md`**，本文件不重复。
本文件只写两件 `AGENTS.md` 不管、但在这个 fork 里反复出问题的事：

1. **交付纪律** —— 防止「声称做完但实际没验证」（蒸馏自 `mouriya-s-lab/coder-loop`）
2. **fork 同步纪律** —— 防止「以为自己领先，其实上游早已重构并超越」

---

## 第一部分：交付纪律

完整版在 `C:\Users\Administrator\coder-loop\protocol\`
（`checkpoint.md` 写规格 / `evidence.md` 产证据 / `honesty.md` 判完成 / `orchestrator.md` 编排）。
以下是**强制最小集**，优先于「看起来做完了」的直觉。

### 1.1 只报告观测，不报告预期

成功措辞（**通过 / 可用 / 已验证 / 完成**）只能描述**本轮真正执行并观测到**的结果。
每条成功声明都要能指到支撑它的观测：命令 + exit code + 输出摘录，或 artifact 路径。

**声明有而观测无 = 该声明为假。** 以下都不是观测：

| 不是观测 | 为什么 |
|---|---|
| 「应该能跑」「逻辑上正确」 | 推理不是执行 |
| 「上一轮跑过」 | 代码已变 |
| 「启动成功」 | startup ≠ behavior |
| 「本地是好的」 | 本地 ≠ live |
| 「typecheck 过了」 | 编译 ≠ 行为正确 |

动手前声明 Intent（理解 / scope / 已知不确定性），完成后声明 Result（实际发生 + **与 Intent 的差值**）。
**写差值，不要回头改 Intent 迎合结果。**

### 1.2 弱信号清单（只证明工具跑了，永远不是端到端验收）

`systemctl is-active: active` · 没分析 body 的 HTTP 200 · `Apply complete!` ·
只有整套通过数没有针对性用例 · `bun typecheck` / `build` 成功 · 「服务起来了」

### 1.3 验收标准写成可执行表

不写自然语言 checkbox。列名与列序固定，不符即判表损坏：

```markdown
| # | Dimension | Check | Command | Env | Expect |
|---|-----------|-------|---------|-----|--------|
| 1 | function | 会话流不再出现 tool_progress 原始 JSON | `bun run test -- normalize` | local | exit 0 |
| 2 | environment | ECS 换芯后 hub 起得来 | `ssh ecs 'systemctl is-active hapi-hub'` + 读日志无 schema 异常 | ecs | active 且日志无 `SQLite schema` |
| 3 | integration | peter 的 18 条授权迁移后仍可读 | 用 peter 账号登录 web 列会话 | browser | 可见数 = 迁移前基线 |
| 4 | assumption | upstream store 对多余表不报错（未文档化） | 拿真 DB 副本起一次 hub | local | 无 assertRequiredTablesPresent 抛错 |
```

- `Dimension` 四选一：`function` / `environment` / `integration` / `assumption`
- `Check` 写**可观测结果**，不写「采用某实现」
- `Command` 必须在 `Env` 声明的环境**真跑得通**
- **维度覆盖强制**：涉及部署/容器 → 必有 `environment` 行；有下游消费 → 必有 `integration` 行；依赖第三方未文档化行为 → 必有 `assumption` 行

**本机跑不了的行不许就地跳过**，写进 `## 继承验证义务` 表转移给下游，**且不可二次推迟**。

#### 本仓库的 `Env` 词表

| Env | 指什么 |
|---|---|
| `local` | 当前工作机（通常 vircs） |
| `vircs` | WIN-GVHSJ7B378A — Windows Server，编译/部署机 |
| `desktop` | DESKTOP-4SQALMG |
| `ecs` | `root@101.133.153.229` — **生产 hub**，`hapi-hub.service`，DB `/root/.hapi/hapi.db` |
| `mac` / `desktop-ht3p09u` | runner 机器，见 `hapi-fleet-ssh-access` 记忆 |
| `browser` | 真实浏览器驱动真实 UI |
| `CI` | GitHub Actions |

### 1.4 证据口径

- **「没有 auth」「没有二进制」永远不是 blocker**，是没做完的 setup。唯一合法 blocker 是 setup 完成后外部服务仍真的够不着（附尝试过的命令 + 输出 + exit）。
- **E2E 是直跑真实入口或真实 UI**。包一层 harness 的脚本 e2e 不算端到端。mock / stub / 录制回放永远不算端到端证据。
- 真路径跑不了 → 记确切命令 + 失败模式 + exit + 日志摘录当 blocker，**不要换弱路径当真的呈上**。
- **日志证据是文本**（命令 + exit + 摘录），不要截屏终端。截图必须拍**真实运行的系统**。
- **测试计数取 runner 自己的汇总行**（`Tests:` / `Ran N tests`），禁止 `rg` 静态数 `test(`。

### 1.5 七类缩水检测（语义等价即触发，诚实承认不中和）

| Trigger | 长什么样 |
|---|---|
| 路径旁路 | 「用 shell 拉起的不是目标 runtime」「合成 harness」「隔离探测」 |
| 不变量降级 | 「近似为」「检查前缀而非相等」「用 X 验证不是字面 Y」 |
| **外观搪塞** | 「展示层瑕疵」「cosmetic」「off-by-one 而已」——**一律硬拒** |
| 跨任务推迟 | 「推迟到 #N」「本任务范围外」 |
| 前置条件承认 | 「必需服务没在跑」「够不着，用了替代品」 |
| 意图—行动错位 | 声明 scope 与实际改动足迹不对应且差值未披露 |
| 测试弱化 | 测试被删 / skip / 放松 / 重写以通过，而规格没要求 |

**授权规则**：trigger 只有在任务规格里存在**一句字面授权该项具体替换**的句子时才豁免。
不得凭「规格大概是这个意思」提升为已授权。**规格沉默 → trigger 成立。**

### 1.6 缺口披露

没做、部分做、不确定、被替代的东西，全部列出来。**承认缺口比被发现遗漏便宜，但承认不等于该缺口可接受。**
需要问人而人不在时 → 记入 Problems 交上级裁决，**不要自行决定**。

---

## 第二部分：fork 同步纪律

### 2.1 三层 remote，别搞混

| remote | 是什么 | 方向 |
|---|---|---|
| `origin` = `bobmcmxciv/hapi` | 我的 fork | push |
| `upstream` = `mouriya-s-lab/hapi` | **协作 fork，PR 合入这里** | pull + PR |
| `tiann` = `tiann/hapi` | 原始上游 | 只读 |

`upstream` **不是**被动的下游——它有自己的维护者、自己的 PR 流、自己的重构决策，而且**跑得比本地快**。

### 2.2 同步前必做：先查上游是否已经吸收并重构了你的功能

**这是本 fork 最贵的教训。** 本地功能 PR 合进 `upstream` 后，upstream 会继续**重构它**——
换目录、换表名、换架构。此时本地那份就成了**过时的重复实现**，而不是「我领先的部分」。

同步前按顺序做三件事：

1. **读 `fork-features/ownership.tsv` 和 `fork-features/trunk-patches.md`**（upstream 维护的权威账本）
   —— 它逐路径记录了哪些偏离属于 fork、缺哪个 upstream seam、同步时怎么验证。
2. **对「本地独有文件」逐个定性**，只有两种结论，不许模糊：
   - `superseded` — upstream 已用别的形态实现 → **删掉本地版，取 upstream**
   - `unique` — upstream 确实没有 → **必须重新落回**
3. **产出定性清单再动手**。不列清单直接 merge，等于让 git 替你做架构决策。

```bash
# 上游新增了什么（我没有的文件）
git diff HEAD upstream/main --name-status --diff-filter=A
# 我有而上游删掉的 —— 这批最危险，逐个定性 superseded / unique
git diff HEAD upstream/main --name-status --diff-filter=D
```

### 2.3 schema 版本对账：比迁移内容，不比版本号

hub 的 `SCHEMA_VERSION` 在 fork 和 upstream 会**独立漂移到不同数字，但内容可能等价**。
`hub/src/store/index.ts` 在 `currentVersion !== SCHEMA_VERSION` 时**直接抛错拒绝启动**，
所以换芯前必须对账，而且**只能比列，不能比数字**：

```bash
# 1. 两边迁移函数体逐个读，列出各自实际加了哪些列/表
# 2. 拿生产库验证目标版本要求的列是否已存在
ssh ecs 'sqlite3 /root/.hapi/hapi.db "PRAGMA user_version;"'
ssh ecs 'sqlite3 /root/.hapi/hapi.db "PRAGMA table_info(sessions);"'
```

- **列等价而版本号不等** → 改 `PRAGMA user_version` 即可，不需要重建库。
- **多出来的表/列是安全的** —— upstream 的 `assertRequiredTablesPresent()` 只检查白名单**存在**，不禁止多余表。多余表还能当回滚安全网。
- **少列才是真迁移**，此时必须写迁移脚本 + 拿生产库副本干跑。

### 2.4 数据迁移必须先查外键与孤儿行

换存储形态（本地表 → 独立 gateway 库）时，**先查孤儿行再写脚本**。
真实例子：18 条 `resource_grants` 里有 6 条指向已被删除的 session 行；
目标 schema 的 `gateway_grants` 有 FK 指向 `gateway_resources`，这 6 条会直接违反外键。
**先查清是「孤儿可弃」还是「真实数据要保」，再决定脚本行为——不要让 FK 报错替你做决定。**

### 2.5 合并 ≠ 上线

见 `.claude/rules/hapi-fork-cd-release.rule.md`。homelab / ECS 跑的是**钉死版本的预编译二进制**，
代码进 `main` 不会自动生效。合并后必须主动问 operator 是否现在 CD。

### 2.6 部署链路已知坑（每条都踩过）

| 坑 | 正确做法 |
|---|---|
| `build-executable.ts --with-web-assets` **只校验不重建** web 资产 | 必须先 `bun run build:web` + `cd hub && bun run generate:embedded-web-assets` 再编 |
| ⚠️ `build-executable.ts` **不带** `--with-web-assets` 跑一次，会把 `hub/src/web/embeddedAssets.generated.ts` **静默覆写成 stub** | 这个仓库里永远带上该标志。误跑了就重跑 `generate:embedded-web-assets` 恢复（正常是 228 行 / 108 资产，stub 只有 10 行） |
| ⚠️ 构建失败时 `dist-exe/` 里**留着上一次的旧二进制**，sha256 与已部署的一模一样 | 必须查 exit code，并**比对新旧 sha256 确认确实变了**，否则会把旧二进制当新的发出去 |
| ⚠️ bun 交叉编译报 `Error initializing ELF file: error.OutOfMemory` | 看的不是物理内存而是 **Windows 提交量**：`(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory`。<2GB 就编不动，8GB 空闲 RAM 也没用。最小样例能编成功即可排除工具链问题 |
| ⚠️ `bun run test:cli` 的 `runner.integration.test.ts` 会 spawn 真实 runner + CLI，**失败时不清理** | 每个孤儿进程约 450MB 提交，跑几次就吃光提交量。识别：`bun.exe` + `--cwd <worktree>\cli` + **零出站连接**；真实会话是 `hapi.exe` 且连着 hub:443。清理前必须用这两个特征区分 |
| ECS 出网被锁死，GitHub / npmmirror 全 `http=000` | 唯一通道是 **scp 推送**（入站 22） |
| 单条 scp 只有 ~24KB/s（143ms / 20% 丢包） | `split -b 12m` + 并行 scp，但 **`-P 8` 会把链路打崩**（`Connection reset by peer`）。用 `-P 2~4`，并写重试循环直到逐块 md5 全过 |
| ⚠️ **传输"完成"不能看大小** | 只认**逐块 md5**。曾用 `du -sm >= 62` 判完成，触发时首块还差 786KB；另一次 6 块里 4 块内容损坏但 scp 报完成 |
| ⚠️ 后台命令用 `;` 串联时，**末尾命令的退出码会掩盖前面的失败** | scp 实际 `exit 124` 却因链末 `ssh md5sum` 成功而被报成 exit 0。串联时显式捕获每段 `$?` 并打印 |
| 长传输被工具 2min 超时 kill → ECS 侧僵尸续写把分块撑坏 | **必须 `run_in_background`** |
| 替换运行中的二进制报 `Text file busy` | 用 `mv` rename 换芯，别覆写 |
| 换芯前没备份 | 二进制 + 主库 + **gateway 库**都备份，命名 `*.pre-<tag>-<ts>` |
| 判断机器在线看 DB 的 `machines.active` | 那是持久化旧值**不可信**，要看 hub 内存态 `/api/machines`（用 `POST /api/auth` 拿 `{"accessToken": <cliApiToken>}` 换 JWT） |
| 归档会话没能杀掉本机 CLI 进程 | `archiveSession()` 是经 **RPC** 发 `killSession`，CLI 与 hub 断连时抛 `RpcTargetMissingError`，走容错分支只改元数据**不杀进程**。断连的孤儿只能本机清 |

### 2.7 本仓库禁止

- 把「PR 合并了」当成「已上线」
- 跳过 Release 手 build 二进制塞给部署
- 产物未发布 / CI 未绿就去开 `iac:deploy` issue
- **不做 superseded/unique 定性就 merge upstream**
- **只比 `SCHEMA_VERSION` 数字就断言不兼容**

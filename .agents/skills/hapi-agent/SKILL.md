---
name: hapi-agent
summary: 在 HAPI session 内通过 hapi agent CLI 编排同机同目录、祖先/后代目录或同 worktree 家族的其他 session。
description: Spawn, prompt, wait for, read, list, inspect, and stop scoped HAPI sessions through the hub-backed hapi agent CLI. Use only when running inside a HAPI session. Requires HAPI_SESSION_ID.
---

# HAPI session 编排

用 `hapi agent` 编排其他 session。命令经过 Hub 的现有 session、消息队列、权限和 runner 通路；不要另写 JWT/curl 投递逻辑。

## 前置检查

```bash
test -n "$HAPI_SESSION_ID"
```

若失败，说明当前进程不在 HAPI session 内并停止。所有 session 定位都使用命令返回的完整 `sessionId`；不要使用前缀或名称。

## 标准流程

1. 先运行 `hapi agent list`，复用范围内已有的合适 session。
2. 没有合适目标时运行：

   ```bash
   hapi agent start "$PWD" --kind claude
   ```

   从 stdout JSON 读取完整 `sessionId`，不要预测 ID。
3. 投递任务并等待目标 settled：

   ```bash
   hapi agent prompt <full-session-id> "<task>" --wait --timeout 180000
   ```

   `idle` 表示本轮完成；`blocked` 表示有待处理的 permission/question request。目标已在工作时，消息进入 HAPI 现有队列，不会打断当前轮。
4. 读取最新结果：

   ```bash
   hapi agent read <full-session-id>
   ```

5. 用 `hapi agent get <full-session-id>` 查看状态与精简的 pending request 摘要。处置审批后运行 `hapi agent wait <full-session-id>`。

## 历史分页

`read` 缺省返回最新一页。需要更早历史时，只跟随响应里的游标：

```bash
hapi agent read <full-session-id> --limit 20 \
  --before-seq <page.nextBeforeSeq> \
  --before-at <page.nextBeforeAt>
```

当 `page.hasMore` 为 `false` 时停止。不要猜测或自行递减 `seq`。缺省输出是低噪投影；只有调试存储信封时使用 `--raw`。

## 状态等待

```bash
hapi agent wait <full-session-id> --until blocked --timeout 180000
hapi agent wait <full-session-id> --until idle --timeout 180000
```

缺省 `wait` 与 `prompt --wait` 等待 `idle` 或 `blocked`。`agent_prompt_stalled` 表示目标没有消费新 prompt；`dead_target` 表示目标已退出。遇到这些错误时先 `get`，必要时只停止自己启动的 session，再重新 `start`。

## 范围与安全

- Hub 对每个动词强制同机，并要求目录相同、互为祖先/后代，或属于同一 worktree 家族。
- 关系双向：子目录 session 可以向祖先目录 session 投递。
- 不要停止不是自己启动的 session。
- 用 `hapi agent stop <full-session-id>` 停止自己创建的子 session。

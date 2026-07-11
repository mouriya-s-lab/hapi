import type { Database } from 'bun:sqlite';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { logger } from '@/ui/logger';
import type {
    CcSwitchProviderSummary,
    SwitchCcSwitchProviderResponse
} from '@hapi/protocol/apiTypes';

/**
 * cc-switch 集成:读取/切换本机 cc-switch 管理的 Claude Code 供应商。
 *
 * cc-switch 在 ~/.cc-switch/cc-switch.db 维护供应商(gaccode/glm/deepseek 等)。
 * 切换供应商 = 改 ANTHROPIC_BASE_URL/AUTH_TOKEN(写入 ~/.claude/settings.json),是进程级动作,
 * 因此切换后需要重启会话进程才能让新供应商生效(由调用方负责重启)。
 *
 * 安全:token / settings_config 等敏感信息只在本机处理,绝不经 RPC 上传。
 */

const CLAUDE_APP_TYPE = 'claude';

// bun:sqlite 只在 Bun 运行时可用；vitest(Node) 会加载本模块的 import 图，
// 顶层静态 import 会让所有间接依赖此文件的测试文件级崩溃，故延迟到调用时解析。
const requireModule = createRequire(import.meta.url);
function loadDatabase(): typeof Database {
    return (requireModule('bun:sqlite') as typeof import('bun:sqlite')).Database;
}

function getCcSwitchDbPath(): string {
    return join(homedir(), '.cc-switch', 'cc-switch.db');
}

function getClaudeSettingsPath(): string {
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(configDir, 'settings.json');
}

type ProviderRow = {
    id: string;
    name: string;
    settings_config: string;
    website_url: string | null;
    category: string | null;
    sort_index: number | null;
    is_current: number;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** 列出 claude 供应商(不含 token)。db 不存在或异常时返回 available:false。 */
export function listCcSwitchProviders(): { available: boolean; providers: CcSwitchProviderSummary[] } {
    const dbPath = getCcSwitchDbPath();
    if (!existsSync(dbPath)) {
        return { available: false, providers: [] };
    }
    let db: Database | null = null;
    try {
        db = new (loadDatabase())(dbPath, { readonly: true });
        const rows = db
            .query(
                "SELECT id, name, settings_config, website_url, category, sort_index, is_current FROM providers WHERE app_type = ? ORDER BY sort_index"
            )
            .all(CLAUDE_APP_TYPE) as ProviderRow[];

        const providers: CcSwitchProviderSummary[] = rows.map((row) => {
            return {
                id: row.id,
                name: row.name,
                category: row.category ?? null,
                websiteUrl: row.website_url ?? null,
                isCurrent: row.is_current === 1
            };
        });
        return { available: true, providers };
    } catch (error) {
        logger.debug('[ccSwitch] Failed to list providers:', error);
        return { available: false, providers: [] };
    } finally {
        db?.close();
    }
}

/**
 * 切换当前供应商:
 * 1. db 中目标 is_current=1,同 app_type 其余=0
 * 2. 把目标 settings_config 的 env/model/effortLevel/hooks 合并写入 ~/.claude/settings.json
 */
export function switchCcSwitchProvider(providerId: string): SwitchCcSwitchProviderResponse {
    const dbPath = getCcSwitchDbPath();
    if (!existsSync(dbPath)) {
        return { success: false, error: 'cc-switch 数据库不存在' };
    }
    let db: Database | null = null;
    try {
        db = new (loadDatabase())(dbPath);
        const row = db
            .query("SELECT id, name, settings_config FROM providers WHERE app_type = ? AND id = ?")
            .get(CLAUDE_APP_TYPE, providerId) as { id: string; name: string; settings_config: string } | null;
        if (!row) {
            throw new Error(`供应商不存在: ${providerId}`);
        }

        const tx = db.transaction(() => {
            db!.query("UPDATE providers SET is_current = 0 WHERE app_type = ?").run(CLAUDE_APP_TYPE);
            db!.query("UPDATE providers SET is_current = 1 WHERE app_type = ? AND id = ?").run(CLAUDE_APP_TYPE, providerId);
            // settings 写入属于同一次切换；失败时让 sqlite transaction 回滚 current flag。
            applyProviderToClaudeSettings(row.settings_config);
        });
        tx();

        return { success: true, currentProviderName: row.name };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('[ccSwitch] Failed to switch provider:', error);
        return { success: false, error: message };
    } finally {
        db?.close();
    }
}

/** 把供应商的 settings_config 合并写入 Claude settings.json,保留 cc-switch 不管的其它键。 */
function applyProviderToClaudeSettings(settingsConfigJson: string): void {
    const settingsConfig = parseJsonObject(settingsConfigJson);
    const settingsPath = getClaudeSettingsPath();

    let current: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
        try {
            current = parseJsonObject(readFileSync(settingsPath, 'utf-8'));
        } catch (error) {
            logger.debug('[ccSwitch] Failed to read existing settings.json, overwriting:', error);
        }
    }

    // 只覆盖 cc-switch 负责的键,保留其它键(如 includeCoAuthoredBy)
    for (const key of ['env', 'model', 'effortLevel', 'hooks', 'language'] as const) {
        if (key in settingsConfig) {
            current[key] = settingsConfig[key];
        }
    }

    writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf-8');
}

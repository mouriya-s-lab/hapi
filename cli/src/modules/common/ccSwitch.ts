import type { Database } from 'bun:sqlite';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/ui/logger';
import type { CcSwitchProviderSummary } from '@hapi/protocol/apiTypes';

/**
 * cc-switch 集成:只读本机 cc-switch provider 配置，为单个 Claude session 生成启动环境。
 *
 * cc-switch 在 ~/.cc-switch/cc-switch.db 维护供应商(gaccode/glm/deepseek 等)。
 * HAPI 不修改 cc-switch DB 或 ~/.claude/settings.json；provider env 只注入目标子进程。
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
 * 读取目标 provider 的 env，供 Runner 合并到单个 Claude 子进程的启动环境。
 * 不执行脚本，不修改任何 cc-switch/Claude 全局状态。
 */
export function getCcSwitchProviderLaunchEnv(providerId: string): Record<string, string> {
    const dbPath = getCcSwitchDbPath();
    if (!existsSync(dbPath)) {
        throw new Error('cc-switch 数据库不存在');
    }
    let db: Database | null = null;
    try {
        db = new (loadDatabase())(dbPath, { readonly: true });
        const row = db
            .query("SELECT id, name, settings_config FROM providers WHERE app_type = ? AND id = ?")
            .get(CLAUDE_APP_TYPE, providerId) as { id: string; name: string; settings_config: string } | null;
        if (!row) {
            throw new Error(`供应商不存在: ${providerId}`);
        }

        const config = parseJsonObject(row.settings_config);
        const env = config.env && typeof config.env === 'object' ? config.env as Record<string, unknown> : {};
        return Object.fromEntries(Object.entries(env).map(([key, value]) => {
            if (typeof value !== 'string') throw new Error(`cc-switch env ${key} 必须是字符串`);
            return [key, value];
        }));
    } finally {
        db?.close();
    }
}

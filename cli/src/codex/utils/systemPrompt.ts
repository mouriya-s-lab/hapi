/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hapi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import { DISPLAY_IMAGE_PROMPT_CODEX, DISPLAY_VIDEO_PROMPT_CODEX, SEND_FILE_PROMPT_CODEX } from '@/modules/common/displayImagePrompt';

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call it once after the user's initial request is clear, and set a concise task title.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording.
    Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    ${DISPLAY_IMAGE_PROMPT_CODEX}
    ${DISPLAY_VIDEO_PROMPT_CODEX}
    ${SEND_FILE_PROMPT_CODEX}
    When the user cites another HAPI session as [title](/sessions/<id>) (or a bare /sessions/<id>), extract that <id>. Call functions.hapi__inspect_peer with sessionIdPrefix=<id> to read metadata and recent messages; call functions.hapi__ping_peer with sessionIdPrefix=<id> and a message to nudge or hand off. Prefer these over JWT+curl. Shell fallbacks: hapi inspect-peer <id> / hapi ping-peer <id> <message>.
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = TITLE_INSTRUCTION;

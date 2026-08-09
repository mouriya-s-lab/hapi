/**
 * OpenCode-specific system prompt for hapi MCP tools (change_title, display_image, display_video).
 *
 * OpenCode exposes MCP tools with the naming pattern: <server-name>_<tool-name>
 * The hapi MCP server exposes `change_title`, `display_image`, and `display_video`.
 */

import { trimIdent } from '@/utils/trimIdent';
import { DISPLAY_IMAGE_PROMPT_HAPI_MCP, DISPLAY_VIDEO_PROMPT_HAPI_MCP, SEND_FILE_PROMPT_HAPI_MCP } from '@/modules/common/displayImagePrompt';
import { buildSessionCitationSteerInstruction } from '@hapi/protocol/sessionCitation';
import { SKILL_LOOKUP_INSTRUCTION } from '@/modules/common/skillLookupInstruction';

/**
 * Title and display_image instructions for OpenCode to call the hapi MCP tools.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call the tool "hapi_change_title" once after the user's initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    ${DISPLAY_IMAGE_PROMPT_HAPI_MCP}
    ${DISPLAY_VIDEO_PROMPT_HAPI_MCP}
    ${SEND_FILE_PROMPT_HAPI_MCP}
    When you create or find a local image file that the user should see, call the tool "hapi_display_image" with the image path so HAPI can show it inline.
    ${buildSessionCitationSteerInstruction({
        inspectTool: 'hapi_inspect_peer',
        pingTool: 'hapi_ping_peer',
        listPeersTool: 'hapi_list_peers',
    })}
    ${SKILL_LOOKUP_INSTRUCTION}
`);

/**
 * Tool instructions for native ACP sessions. Title updates come from ACP, so
 * advertise only the MCP tools that remain available to the model.
 */
export const OPENCODE_NATIVE_TOOL_INSTRUCTION = trimIdent(`
    When you create or find a local image file that the user should see, call the tool "hapi_display_image" with the image path so HAPI can show it inline.
    ${buildSessionCitationSteerInstruction({
        inspectTool: 'hapi_inspect_peer',
        pingTool: 'hapi_ping_peer',
        listPeersTool: 'hapi_list_peers',
    })}
    ${SKILL_LOOKUP_INSTRUCTION}
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = TITLE_INSTRUCTION;

/**
 * Instruction prepended to OpenCode prompts while HAPI plan mode is active.
 */
export const PLAN_MODE_INSTRUCTION = trimIdent(`
    You are in plan mode. Do not execute tools or make changes. Analyze the request, ask clarifying questions if needed, and respond with a concise implementation plan only.
`);

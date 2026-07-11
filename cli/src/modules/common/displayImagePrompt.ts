import { trimIdent } from '@/utils/trimIdent';

/**
 * Shared display_image MCP tool hints — one export per tool naming convention.
 * Inject into flavor system prompts and first-prompt bridge instructions.
 */
export const DISPLAY_IMAGE_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local image file that the user should see, call the tool "mcp__hapi__display_image" with the image path so HAPI can show it inline.
`);

export const DISPLAY_IMAGE_PROMPT_CODEX = trimIdent(`
    When you create or find a local image file that the user should see, call functions.hapi__display_image with the image path. If that exact tool name is unavailable, use an equivalent alias such as hapi__display_image, mcp__hapi__display_image, or hapi_display_image.
`);

export const DISPLAY_IMAGE_PROMPT_HAPI_MCP = trimIdent(`
    When you create or find a local image file that the user should see, call the tool "hapi_display_image" with the image path so HAPI can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_image or mcp__hapi__display_image.
`);

export const DISPLAY_VIDEO_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "mcp__hapi__display_video" with the file path so HAPI can show it inline.
`);

export const DISPLAY_VIDEO_PROMPT_CODEX = trimIdent(`
    When you create or find a local mp4 or webm file the user should see, call functions.hapi__display_video with the file path. If that exact tool name is unavailable, use an equivalent alias such as hapi__display_video, mcp__hapi__display_video, or hapi_display_video.
`);

export const DISPLAY_VIDEO_PROMPT_HAPI_MCP = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "hapi_display_video" with the file path so HAPI can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_video or mcp__hapi__display_video.
`);

export const SEND_FILE_PROMPT_CLAUDE = trimIdent(`
    When you produce a deliverable file the user asked for (a report, document, archive, spreadsheet, etc.), call the tool "mcp__hapi__send_file" with the file path so HAPI can share it in the chat for the user to download.
`);

export const SEND_FILE_PROMPT_CODEX = trimIdent(`
    When you produce a deliverable file the user asked for (a report, document, archive, spreadsheet, etc.), call functions.hapi__send_file with the file path so HAPI can share it in the chat for the user to download. If that exact tool name is unavailable, use an equivalent alias such as hapi__send_file, mcp__hapi__send_file, or hapi_send_file.
`);

export const SEND_FILE_PROMPT_HAPI_MCP = trimIdent(`
    When you produce a deliverable file the user asked for (a report, document, archive, spreadsheet, etc.), call the tool "hapi_send_file" with the file path so HAPI can share it in the chat for the user to download. If that exact tool name is unavailable, use an equivalent alias such as send_file or mcp__hapi__send_file.
`);

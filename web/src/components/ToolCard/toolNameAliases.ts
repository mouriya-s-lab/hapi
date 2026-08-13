/**
 * OMP (and some other agents) emit lowercase tool names (`read`, `bash`, …)
 * while the web tool cards/registries are keyed on Claude-style names
 * (`Read`, `Bash`, …). Without this map, result views fall through to the
 * generic markdown renderer, which collapses newlines/indentation into a
 * single unreadable run of characters.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
    read: 'Read',
    bash: 'Bash',
    grep: 'Grep',
    glob: 'Glob',
    ls: 'LS',
    edit: 'Edit',
    write: 'Write',
    multiedit: 'MultiEdit',
    todo: 'TodoWrite',
    todowrite: 'TodoWrite',
    task: 'Task',
    agent: 'Agent',
    webfetch: 'WebFetch',
    web_fetch: 'WebFetch',
    websearch: 'WebSearch',
    web_search: 'WebSearch',
    notebookread: 'NotebookRead',
    notebook_read: 'NotebookRead',
    notebookedit: 'NotebookEdit',
    notebook_edit: 'NotebookEdit',
    skill: 'Skill',
}

/**
 * Map an agent-emitted tool name onto the canonical registry key when one is
 * known. Unknown names (including MCP tools) pass through unchanged.
 */
export function resolveToolViewName(toolName: string): string {
    if (TOOL_NAME_ALIASES[toolName]) return TOOL_NAME_ALIASES[toolName]
    const lower = toolName.toLowerCase()
    if (lower !== toolName && TOOL_NAME_ALIASES[lower]) return TOOL_NAME_ALIASES[lower]
    return toolName
}

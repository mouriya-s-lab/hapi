import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject } from '@hapi/protocol'
import { FileContentToggleView } from '@/components/FileContentToggleView'
import { DiffView } from '@/components/DiffView'
import { getInputStringAny } from '@/lib/toolInputUtils'

export function WriteView(props: ToolViewProps) {
    const input = props.block.tool.input
    if (!isObject(input)) return null

    const content = typeof input.content === 'string' ? input.content : typeof input.text === 'string' ? input.text : null
    if (content === null) return null
    const filePath = getInputStringAny(input, ['file_path', 'path'])

    if (props.surface === 'dialog') {
        // The dialog is the "click a file -> popup preview" surface; show the
        // written content with the fork's markdown-preview + word-wrap toggles
        // (Write outputs a file, so it must offer the same preview as Read).
        return (
            <div className="flex flex-col gap-2">
                {filePath ? (
                    <div className="text-xs text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                ) : null}
                <FileContentToggleView content={content} path={filePath ?? null} />
            </div>
        )
    }

    return (
        <DiffView
            oldString=""
            newString={content}
            variant="inline"
        />
    )
}

import { type FC } from 'react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { cn } from '@/lib/utils'
import {
    MARKDOWN_CLASSNAME,
    MARKDOWN_COMPONENTS_BY_LANGUAGE,
    MARKDOWN_PLUGINS,
    MARKDOWN_REHYPE_PLUGINS,
    defaultComponents,
    denyOnlyTransform,
    UriConfirmProvider,
} from '@/components/assistant-ui/markdown-text'

export { ReasoningGroup } from './reasoning-group'

export const Reasoning: FC = () => {
    return (
        <UriConfirmProvider>
            <MarkdownTextPrimitive
                remarkPlugins={MARKDOWN_PLUGINS}
                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                components={defaultComponents}
                componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
                urlTransform={denyOnlyTransform}
                className={cn(MARKDOWN_CLASSNAME, 'aui-reasoning-content text-[13.5px] text-[var(--app-hint)]')}
            />
        </UriConfirmProvider>
    )
}

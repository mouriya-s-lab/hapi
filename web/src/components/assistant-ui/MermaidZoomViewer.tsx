import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { cn } from '@/lib/utils'

type MermaidZoomViewerProps = {
    /** Rendered Mermaid SVG markup (already validated by the caller). */
    svg: string
    className?: string
}

const controlButtonClass =
    'flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-black shadow-md hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

/**
 * Interactive viewer for a rendered Mermaid SVG: pinch-zoom on touch, wheel /
 * double-click zoom on desktop, drag-to-pan, and explicit zoom in / out / reset
 * controls. Lives in a fork-owned file so the upstream mermaid-diagram component
 * only needs a one-line swap (keeps rebase cost low). The SVG box is pinned to a
 * definite width because Mermaid emits `width="100%"`, which would collapse to
 * zero inside the shrink-to-fit transform content otherwise.
 */
export function MermaidZoomViewer({ svg, className }: MermaidZoomViewerProps) {
    return (
        <div className={cn('relative h-full w-full overflow-hidden', className)}>
            <TransformWrapper
                initialScale={1}
                minScale={0.3}
                maxScale={12}
                centerOnInit
                limitToBounds={false}
            >
                {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                        <div
                            data-mermaid-zoom-controls
                            className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex gap-1.5"
                        >
                            <button
                                type="button"
                                aria-label="Zoom in"
                                title="Zoom in"
                                onClick={() => zoomIn()}
                                className={controlButtonClass}
                            >
                                +
                            </button>
                            <button
                                type="button"
                                aria-label="Zoom out"
                                title="Zoom out"
                                onClick={() => zoomOut()}
                                className={controlButtonClass}
                            >
                                −
                            </button>
                            <button
                                type="button"
                                aria-label="Reset zoom"
                                title="Reset zoom"
                                onClick={() => resetTransform()}
                                className={cn(controlButtonClass, 'text-base')}
                            >
                                ⤢
                            </button>
                        </div>
                        <TransformComponent
                            wrapperClass="!h-full !w-full touch-none"
                            wrapperStyle={{ cursor: 'grab' }}
                        >
                            <div
                                data-mermaid-zoom-canvas
                                className="w-[min(88vw,960px)] [&_svg]:!h-auto [&_svg]:!w-full [&_svg]:!max-w-none"
                                dangerouslySetInnerHTML={{ __html: svg }}
                            />
                        </TransformComponent>
                    </>
                )}
            </TransformWrapper>
        </div>
    )
}

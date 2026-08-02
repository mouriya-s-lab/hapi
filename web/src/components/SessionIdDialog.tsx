import { useEffect, useRef } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { resolveAgentSessionIdFromMetadata } from '@/lib/sessionResume'
import type { Session } from '@/types/api'

type SessionIdDialogProps = {
    isOpen: boolean
    onClose: () => void
    session: Session
}

export function SessionIdDialog(props: SessionIdDialogProps) {
    const { t } = useTranslation()
    const { isOpen, onClose, session } = props
    // The agent thread id the hub honors for resume, flavor-specific.
    const sessionId = resolveAgentSessionIdFromMetadata(session.metadata)
    const inputRef = useRef<HTMLInputElement>(null)
    const { copied, copy } = useCopyToClipboard()

    useEffect(() => {
        if (isOpen && sessionId) {
            // Preselect so a manual Cmd/Ctrl+C works even when the async
            // clipboard API is blocked (the input is the reliable fallback).
            setTimeout(() => {
                inputRef.current?.focus()
                inputRef.current?.select()
            }, 100)
        }
    }, [isOpen, sessionId])

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.sessionId.title')}</DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex flex-col gap-4">
                    {sessionId ? (
                        <>
                            <p className="text-sm text-[var(--app-hint)]">
                                {t('dialog.sessionId.description')}
                            </p>
                            <div className="flex items-stretch gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={sessionId}
                                    readOnly
                                    onFocus={(e) => e.currentTarget.select()}
                                    data-testid="session-id-input"
                                    className="w-full min-w-0 flex-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 font-mono text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                                />
                                <Button
                                    type="button"
                                    onClick={() => void copy(sessionId)}
                                    data-testid="session-id-copy"
                                >
                                    {copied ? t('button.copied') : t('button.copy')}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <p
                            className="text-sm text-[var(--app-hint)]"
                            data-testid="session-id-empty"
                        >
                            {t('dialog.sessionId.empty')}
                        </p>
                    )}
                    <div className="flex justify-end">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            {t('button.close')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

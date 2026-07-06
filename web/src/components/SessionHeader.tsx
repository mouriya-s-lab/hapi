import { useId, useMemo, useRef, useState } from 'react'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useFlavorCapabilities } from '@/hooks/queries/useFlavorCapabilities'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionExportDialog } from '@/components/SessionExportDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { SessionIdDialog } from '@/components/SessionIdDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatReopenError } from '@/lib/reopenError'
import { getSessionModelLabel, formatCcSwitchSourceLabel } from '@/lib/sessionModelLabel'
import { useCcSwitchProviders } from '@/hooks/queries/useCcSwitchProviders'
import { useCcSwitchUsage } from '@/hooks/queries/useCcSwitchUsage'
import { useTranslation } from '@/lib/use-translation'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function OutlineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
        </svg>
    )
}

function headerToggleClass(active: boolean): string {
    return `flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        active
            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90'
            : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
    }`
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onToggleFiles?: () => void
    filesActive?: boolean
    onToggleOutline?: () => void
    outlineActive?: boolean
    api: ApiClient | null
    onSessionDeleted?: () => void
    onSessionReopened?: (newSessionId: string) => void
    onSessionForked?: (newSessionId: string) => void
}) {
    const { t } = useTranslation()
    const { session, api, onSessionDeleted, onSessionReopened, onSessionForked } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const modelLabel = getSessionModelLabel(session)

    // cc-switch 源 + 用量(仅 claude flavor):顶部用"源名 · 剩余用量"替代模型标签。
    const flavor = session.metadata?.flavor ?? null
    const sessionMachineId = session.metadata?.machineId ?? null
    const ccSwitchEnabled = flavor === 'claude' && Boolean(sessionMachineId)
    const ccSwitchProvidersState = useCcSwitchProviders({
        api,
        machineId: sessionMachineId,
        enabled: ccSwitchEnabled
    })
    const ccSwitchUsageState = useCcSwitchUsage({
        api,
        machineId: sessionMachineId,
        // 不指定 providerId,查当前选中供应商;仅当 cc-switch 可用且有当前源时才查。
        enabled: ccSwitchEnabled && ccSwitchProvidersState.available && Boolean(ccSwitchProvidersState.currentProviderId)
    })
    const ccSwitchSourceLabel = ccSwitchProvidersState.available
        ? formatCcSwitchSourceLabel(
            ccSwitchUsageState.providerName
                ?? ccSwitchProvidersState.providers.find((p) => p.isCurrent)?.name
                ?? null,
            ccSwitchUsageState.usage,
            t('session.item.remaining')
        )
        : null

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [sessionIdOpen, setSessionIdOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const { archiveSession, reopenSession, renameSession, deleteSession, forkSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )
    const { data: capabilities } = useFlavorCapabilities(api)
    const sessionFlavor = session.metadata?.flavor ?? null
    const forkSupported =
        Boolean(sessionFlavor) && (capabilities?.fork?.includes(sessionFlavor as string) ?? false)
    const [reopenError, setReopenError] = useState<string | null>(null)
    const [forkError, setForkError] = useState<string | null>(null)

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleReopen = async () => {
        setReopenError(null)
        try {
            const result = await reopenSession()
            if (result.sessionId && result.sessionId !== session.id) {
                onSessionReopened?.(result.sessionId)
            }
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const handleFork = async () => {
        setForkError(null)
        try {
            const { newSessionId } = await forkSession()
            onSessionForked?.(newSessionId)
        } catch (error) {
            setForkError(error instanceof Error ? error.message : 'Fork failed')
        }
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <AgentFlavorIcon flavor={session.metadata?.flavor} className="h-3.5 w-3.5 shrink-0" />
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            {ccSwitchSourceLabel ? (
                                <span>{ccSwitchSourceLabel}</span>
                            ) : modelLabel ? (
                                <span>
                                    {t(modelLabel.key)}: {modelLabel.value}
                                </span>
                            ) : null}
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {props.onToggleFiles ? (
                        <button
                            type="button"
                            onClick={props.onToggleFiles}
                            className={headerToggleClass(props.filesActive ?? false)}
                            title={props.filesActive ? t('session.view.returnToChat') : t('session.title')}
                            aria-label={props.filesActive ? t('session.view.returnToChat') : t('session.title')}
                            aria-pressed={props.filesActive ?? false}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    {props.onToggleOutline ? (
                        <button
                            type="button"
                            onClick={props.onToggleOutline}
                            className={headerToggleClass(props.outlineActive ?? false)}
                            title={props.outlineActive ? t('session.outline.close') : t('session.outline.open')}
                            aria-label={props.outlineActive ? t('session.outline.close') : t('session.outline.open')}
                            aria-pressed={props.outlineActive ?? false}
                        >
                            <OutlineIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onRename={() => setRenameOpen(true)}
                onShowSessionId={() => setSessionIdOpen(true)}
                onExport={() => setExportOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onReopen={handleReopen}
                onDelete={() => setDeleteOpen(true)}
                onFork={forkSupported ? handleFork : undefined}
                forkSupported={forkSupported}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            {forkError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setForkError(null)}
                    title={t('dialog.fork.errorTitle', { defaultValue: 'Fork failed' })}
                    description={forkError}
                    confirmLabel={t('dialog.fork.dismiss', { defaultValue: 'OK' })}
                    confirmingLabel={t('dialog.fork.dismiss', { defaultValue: 'OK' })}
                    onConfirm={async () => setForkError(null)}
                    isPending={false}
                />
            ) : null}

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                />
            ) : null}

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <SessionIdDialog
                isOpen={sessionIdOpen}
                onClose={() => setSessionIdOpen(false)}
                session={session}
            />

            <SessionExportDialog
                isOpen={exportOpen}
                onClose={() => setExportOpen(false)}
                session={session}
                api={api}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )
}

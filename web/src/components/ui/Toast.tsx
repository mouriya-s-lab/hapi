import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toastVariants = cva(
    'pointer-events-auto w-full max-w-sm rounded-lg border shadow-lg',
    {
        variants: {
            variant: {
                default: 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)]',
                warning: 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

const toastBodyVariants = cva(
    'mt-1 text-xs',
    {
        variants: {
            variant: {
                default: 'text-[var(--app-hint)]',
                warning: 'text-[var(--app-badge-warning-text)] opacity-90'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

const toastCloseVariants = cva(
    'text-xs',
    {
        variants: {
            variant: {
                default: 'text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                warning: 'text-[var(--app-badge-warning-text)] opacity-70 hover:opacity-100'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

export type ToastProps = React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof toastVariants> & {
    title: string
    body: string
    onClose?: () => void
}

export function Toast({ title, body, onClose, className, variant, ...props }: ToastProps) {
    const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onClose?.()
    }

    return (
        <div className={cn(toastVariants({ variant }), className)} role="status" data-toast-variant={variant ?? 'default'} {...props}>
            <div className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-5">{title}</div>
                    <div className={cn(toastBodyVariants({ variant }))}>{body}</div>
                </div>
                {onClose ? (
                    <button
                        type="button"
                        className={cn(toastCloseVariants({ variant }))}
                        onClick={handleClose}
                        aria-label="Dismiss"
                    >
                        x
                    </button>
                ) : null}
            </div>
        </div>
    )
}

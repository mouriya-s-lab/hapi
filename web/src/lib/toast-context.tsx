import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomId } from '@/lib/randomId'

export type ToastVariant = 'default' | 'warning'

export type Toast = {
    id: string
    title: string
    body: string
    sessionId: string
    url: string
    variant?: ToastVariant
}

export type AddToastInput = Omit<Toast, 'id'> & {
    durationMs?: number
}

export type ToastContextValue = {
    toasts: Toast[]
    addToast: (toast: AddToastInput) => void
    removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const DEFAULT_TOAST_DURATION_MS = 6000

function createToastId(): string {
    return randomId()
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    useEffect(() => {
        return () => {
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer)
            }
            timersRef.current.clear()
        }
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToast = useCallback((toast: AddToastInput) => {
        const id = createToastId()
        const { durationMs, ...visibleToast } = toast
        setToasts((prev) => [...prev, { id, ...visibleToast }])
        const timer = setTimeout(() => {
            removeToast(id)
        }, durationMs ?? DEFAULT_TOAST_DURATION_MS)
        timersRef.current.set(id, timer)
    }, [removeToast])

    const value = useMemo<ToastContextValue>(() => ({
        toasts,
        addToast,
        removeToast
    }), [toasts, addToast, removeToast])

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return ctx
}

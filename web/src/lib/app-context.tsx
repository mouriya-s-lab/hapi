import { createContext, useContext, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { AuthResponse } from '@/types/api'

type AppContextValue = {
    api: ApiClient
    token: string
    baseUrl: string
    user: AuthResponse['user']
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider(props: {
    value: AppContextValue
    children: ReactNode
}) {
    return (
        <AppContext.Provider value={props.value}>
            {props.children}
        </AppContext.Provider>
    )
}

export function useAppContext(): AppContextValue {
    const context = useContext(AppContext)
    if (!context) {
        throw new Error('AppContext is not available')
    }
    return context
}

// 供可能在 provider 外渲染的组件（如测试中的 SessionList）安全读取
export function useOptionalAppContext(): AppContextValue | null {
    return useContext(AppContext)
}

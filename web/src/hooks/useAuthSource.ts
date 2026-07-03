import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTelegramWebApp, isTelegramEnvironment } from './useTelegram'
import type { AuthSource } from './useAuth'

const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'
const PASSWORD_JWT_PREFIX = 'hapi_password_jwt::'

function getTelegramInitData(): string | null {
    const tg = getTelegramWebApp()
    if (tg?.initData) {
        return tg.initData
    }

    // Fallback: check URL parameters (for testing or alternative flows)
    const query = new URLSearchParams(window.location.search)
    const tgWebAppData = query.get('tgWebAppData')
    if (tgWebAppData) {
        return tgWebAppData
    }

    const initData = query.get('initData')
    return initData || null
}

function getTokenFromUrlParams(): string | null {
    if (typeof window === 'undefined') return null
    const query = new URLSearchParams(window.location.search)
    return query.get('token')
}

function getAccessTokenKey(baseUrl: string): string {
    return `${ACCESS_TOKEN_PREFIX}${baseUrl}`
}

function getPasswordJwtKey(baseUrl: string): string {
    return `${PASSWORD_JWT_PREFIX}${baseUrl}`
}

function getStoredValue(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function storeValue(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function clearStoredValue(key: string): void {
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

export function useAuthSource(baseUrl: string): {
    authSource: AuthSource | null
    isLoading: boolean
    isTelegram: boolean
    setAccessToken: (token: string) => void
    setPasswordToken: (jwt: string) => void
    persistPasswordToken: (jwt: string) => void
    clearStoredPasswordToken: () => void
    clearAuth: () => void
} {
    const [authSource, setAuthSource] = useState<AuthSource | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isTelegram, setIsTelegram] = useState(false)
    const retryCountRef = useRef(0)
    const accessTokenKey = useMemo(() => getAccessTokenKey(baseUrl), [baseUrl])
    const passwordJwtKey = useMemo(() => getPasswordJwtKey(baseUrl), [baseUrl])

    // Initialize auth source on mount, with retry for delayed Telegram initData
    useEffect(() => {
        retryCountRef.current = 0
        setAuthSource(null)
        setIsTelegram(false)
        setIsLoading(true)

        const telegramInitData = getTelegramInitData()

        if (telegramInitData) {
            // Telegram Mini App environment
            setAuthSource({ type: 'telegram', initData: telegramInitData })
            setIsTelegram(true)
            setIsLoading(false)
            return
        }

        // Check for URL token parameter (for direct access links)
        const urlToken = getTokenFromUrlParams()
        if (urlToken) {
            storeValue(accessTokenKey, urlToken) // Save to localStorage for refresh
            setAuthSource({ type: 'accessToken', token: urlToken })
            setIsLoading(false)
            return
        }

        // Check for stored access token as fallback
        const storedToken = getStoredValue(accessTokenKey)
        if (storedToken) {
            setAuthSource({ type: 'accessToken', token: storedToken })
            setIsLoading(false)
            return
        }

        // Check for a persisted password-session JWT (multi-user password login).
        // It may be expired; useAuth's refresh will fail and route back to login.
        const storedPasswordJwt = getStoredValue(passwordJwtKey)
        if (storedPasswordJwt) {
            setAuthSource({ type: 'password', token: storedPasswordJwt })
            setIsLoading(false)
            return
        }

        // Check if we're in a Telegram environment before polling
        if (!isTelegramEnvironment()) {
            // Plain browser - show login prompt immediately
            setIsLoading(false)
            return
        }

        // Telegram environment detected - poll for delayed initData
        // Telegram WebApp SDK may initialize slightly after page mount
        const maxRetries = 20
        const retryInterval = 250 // ms

        const interval = setInterval(() => {
            retryCountRef.current += 1
            const initData = getTelegramInitData()

            if (initData) {
                setAuthSource({ type: 'telegram', initData })
                setIsTelegram(true)
                setIsLoading(false)
                clearInterval(interval)
            } else if (retryCountRef.current >= maxRetries) {
                // Give up - show login prompt for browser access
                setIsLoading(false)
                clearInterval(interval)
            }
        }, retryInterval)

        return () => {
            clearInterval(interval)
        }
    }, [accessTokenKey, passwordJwtKey])

    const setAccessToken = useCallback((token: string) => {
        // Access-token and password sessions are mutually exclusive.
        clearStoredValue(passwordJwtKey)
        storeValue(accessTokenKey, token)
        setAuthSource({ type: 'accessToken', token })
    }, [accessTokenKey, passwordJwtKey])

    const setPasswordToken = useCallback((jwt: string) => {
        clearStoredValue(accessTokenKey)
        storeValue(passwordJwtKey, jwt)
        setAuthSource({ type: 'password', token: jwt })
    }, [accessTokenKey, passwordJwtKey])

    // Keep the persisted JWT fresh across sliding-session refreshes without
    // changing the authSource identity (which would re-trigger auth effects).
    const persistPasswordToken = useCallback((jwt: string) => {
        storeValue(passwordJwtKey, jwt)
    }, [passwordJwtKey])

    // Drop a stale/rejected password JWT so the next page load shows a clean
    // login form instead of retrying a dead session.
    const clearStoredPasswordToken = useCallback(() => {
        clearStoredValue(passwordJwtKey)
    }, [passwordJwtKey])

    const clearAuth = useCallback(() => {
        clearStoredValue(accessTokenKey)
        clearStoredValue(passwordJwtKey)
        setAuthSource(null)
    }, [accessTokenKey, passwordJwtKey])

    return {
        authSource,
        isLoading,
        isTelegram,
        setAccessToken,
        setPasswordToken,
        persistPasswordToken,
        clearStoredPasswordToken,
        clearAuth
    }
}

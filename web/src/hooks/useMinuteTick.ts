import { useEffect, useState } from 'react'

export function useMinuteTick(enabled = true): number {
    const [tick, setTick] = useState(0)

    useEffect(() => {
        if (!enabled) return

        const timer = window.setInterval(() => {
            setTick((value) => value + 1)
        }, 60_000)
        return () => window.clearInterval(timer)
    }, [enabled])

    return tick
}

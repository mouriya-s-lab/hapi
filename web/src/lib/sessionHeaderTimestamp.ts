export function formatSessionHeaderTimestamp(value: number, locale?: string): string | null {
    if (!Number.isFinite(value) || value <= 0) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)
}

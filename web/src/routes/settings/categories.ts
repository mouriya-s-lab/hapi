export const settingsCategories = [
    { id: 'general', path: '/settings/general', titleKey: 'settings.general.title' },
    { id: 'display', path: '/settings/display', titleKey: 'settings.display.title' },
    { id: 'chat', path: '/settings/chat', titleKey: 'settings.chat.title' },
    { id: 'voice', path: '/settings/voice', titleKey: 'settings.voice.title' },
    { id: 'account', path: '/settings/account', titleKey: 'settings.fork.account.title' },
    { id: 'users', path: '/settings/users', titleKey: 'settings.fork.users.title' },
    { id: 'fork', path: '/settings/fork', titleKey: 'settings.fork.title' },
    { id: 'about', path: '/settings/about', titleKey: 'settings.about.title' },
] as const

export type SettingsCategory = typeof settingsCategories[number]

export function getSettingsCategory(pathname: string): SettingsCategory | undefined {
    return settingsCategories.find((category) => pathname === category.path || pathname.startsWith(`${category.path}/`))
}

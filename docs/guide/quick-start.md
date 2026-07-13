# Quick Start

<Steps>

## Install HAPI

::: code-group

```bash [npm]
npm install -g @twsxtd/hapi --registry=https://registry.npmjs.org
```

```bash [Homebrew]
brew install tiann/tap/hapi
```

```bash [npx (one-off)]
npx @twsxtd/hapi
```

:::

> Recommendation: use the official npm registry for global install. Some mirrors may not sync platform packages in time.

Other install options: [Installation](./installation.md)

## Start the hub

```bash
hapi hub --relay
```

On first run, HAPI prints an access token and saves it to `~/.hapi/settings.json`.

`hapi server` remains supported as an alias.

The terminal will display a URL and QR code for remote access.

> End-to-end encrypted with WireGuard + TLS.

## Start a coding session

```bash
hapi
```

This starts Claude Code wrapped with HAPI. The session appears in the web UI.

To use Grok, install Grok CLI 0.2.99 or newer, authenticate it natively, then start HAPI's Grok flavor:

```bash
grok login
hapi grok
```

Grok reasoning effort is a creation-time setting for explicit `grok-4.5` sessions. It cannot be changed on an active or resumed session. Grok's native rules, hooks, and permission policies run first; HAPI handles only permission requests that Grok delegates to its ACP client.

## Open the UI

Open the URL shown in the terminal, or scan the QR code with your phone.

Enter your access token to log in.

</Steps>

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HAPI from anywhere
- [Notifications](./installation.md#telegram-setup) - Set up Telegram notifications
- [Install the App](./pwa.md) - Add HAPI to your home screen

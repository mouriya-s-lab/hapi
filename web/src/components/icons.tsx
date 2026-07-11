import type { ReactNode } from 'react'

type IconProps = {
    className?: string
}

function createIcon(paths: ReactNode, props: IconProps, strokeWidth = 1.5) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths}
        </svg>
    )
}

export function DownloadIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
        </>,
        props,
        2
    )
}

export function CloseIcon(props: IconProps) {
    return createIcon(
        <path d="M6 18 18 6M6 6l12 12" />,
        props,
        2
    )
}

export function ShareIcon(props: IconProps) {
    return createIcon(
        <path d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />,
        props
    )
}

export function PlusCircleIcon(props: IconProps) {
    return createIcon(
        <path d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
        props
    )
}

export function CopyIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>,
        props,
        2
    )
}

export function CheckIcon(props: IconProps) {
    return createIcon(
        <polyline points="20 6 9 17 4 12" />,
        props,
        2
    )
}

/** Composer schedule-send clock — circle + hands (matches ComposerButtons). */
export function ScheduleIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
        </>,
        props,
        2
    )
}

/** Magnifying glass with a plus — zoom in. */
export function ZoomInIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5M11 8.5v5M8.5 11h5" />
        </>,
        props
    )
}

/** Magnifying glass with a minus — zoom out. */
export function ZoomOutIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5M8.5 11h5" />
        </>,
        props
    )
}

/** Arrows pointing to four corners — fit / reset zoom. */
export function ExpandIcon(props: IconProps) {
    return createIcon(
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3" />,
        props
    )
}

/** Speaker with sound waves — read aloud. */
export function SpeakerIcon(props: IconProps) {
    return createIcon(
        <>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>,
        props,
        2
    )
}

/** Filled square — stop playback. */
export function StopIcon(props: IconProps) {
    return createIcon(
        <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
        props,
        2
    )
}

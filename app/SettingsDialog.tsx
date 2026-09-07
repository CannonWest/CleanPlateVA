/**
 * The settings dialog (2026-09-06, Cannon's call) — the site's presentation
 * choices in one place, Radix primitives dressed in the theme's tokens:
 * the THEME as a three-way group (Light · Dark · System, the segmented
 * idiom of the band's view switcher), "Group nearby places" as a switch
 * (the words CRP-M6 shipped), and the TEXT SIZE as a slider over the body
 * size in px (settings.ts). Every change applies as it is made and is kept
 * on the device — the App owns the state and the storage; this component
 * only asks. It opens on its own once, on a visitor's first map view after
 * the acknowledgement, and from the Settings button under the band (map
 * view only) any later time. An ordinary dialog: ✕, backdrop, Escape and
 * Done all close it; nothing here is a decision (§6.1's dialog is the one
 * with a fork).
 *
 * Radix does the mechanics — the portal, the focus trap and its return,
 * the scroll lock, aria-modal / labelledby / describedby, the theme
 * group's roving focus and radio semantics, the slider's pointer and
 * arrow-key handling, the switch's role and state — so this file is
 * markup and words. Below `sm` it is a bottom sheet, as the
 * acknowledgement dialog is.
 */

import { Monitor, Moon, Sun, X } from 'lucide-react'
import { Dialog, Slider, Switch, ToggleGroup } from 'radix-ui'
import type { ThemeChoice } from './theme'
import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from './settings'

/** The three options in display order; the labels are the public words. */
export const THEME_OPTIONS: ReadonlyArray<{
    value: ThemeChoice
    label: string
    Icon: typeof Sun
}> = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
    { value: 'system', label: 'System', Icon: Monitor },
]

export function SettingsDialog({
    open, onOpenChange, theme, systemDark, clusters, textSize, onTheme, onClusters, onTextSize,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    theme: ThemeChoice
    /** What 'system' resolves to right now — named in the hint. */
    systemDark: boolean
    clusters: boolean
    textSize: number
    onTheme: (choice: ThemeChoice) => void
    onClusters: (on: boolean) => void
    onTextSize: (size: number) => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-cp-scrim backdrop-blur-[2px]" />
                <Dialog.Content
                    className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(86vh,720px)] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-5 pt-5 pb-4 shadow-cp outline-none max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[92vh] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
                >
                    <Dialog.Close asChild>
                        <button
                            type="button"
                            aria-label="Close"
                            className="absolute top-3.5 right-3.5 text-cp-ink-3 hover:text-cp-ink"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </Dialog.Close>
                    <Dialog.Title className="text-cp-17 font-bold tracking-[.01em]">
                        Settings
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-cp-12 text-cp-ink-3">
                        Applied as you change them and kept on this device.
                    </Dialog.Description>

                    <div className="mt-4 flex flex-col gap-5">
                        <section aria-labelledby="cpSettingsTheme">
                            <h2 id="cpSettingsTheme" className="mb-2 text-cp-13 font-semibold">
                                Theme
                            </h2>
                            <ToggleGroup.Root
                                type="single"
                                value={theme}
                                onValueChange={(value) => {
                                    // Radix hands back '' when the active item is
                                    // pressed again; one option is always on.
                                    if (value) onTheme(value as ThemeChoice)
                                }}
                                aria-label="Theme"
                                className="flex gap-0.5 rounded-cp-control border border-cp-hairline bg-cp-surface-2 p-[3px]"
                            >
                                {THEME_OPTIONS.map(({ value, label, Icon }) => (
                                    <ToggleGroup.Item
                                        key={value}
                                        value={value}
                                        className="flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-3 py-[7px] text-cp-12.5 font-semibold text-cp-ink-2 outline-none hover:text-cp-ink focus-visible:ring-2 focus-visible:ring-cp-focus data-[state=on]:bg-cp-accent-solid data-[state=on]:text-cp-accent-ink data-[state=on]:hover:text-cp-accent-ink"
                                    >
                                        <Icon size={14} aria-hidden="true" />
                                        {label}
                                    </ToggleGroup.Item>
                                ))}
                            </ToggleGroup.Root>
                            <p className="mt-1.5 text-cp-11.5 text-cp-ink-3">
                                System follows the device&apos;s appearance
                                {theme === 'system' ? ` (${systemDark ? 'dark' : 'light'} now).` : '.'}
                            </p>
                        </section>

                        <section aria-labelledby="cpSettingsClustersLabel">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <label
                                        id="cpSettingsClustersLabel"
                                        htmlFor="cpSettingsClusters"
                                        className="text-cp-13 font-semibold"
                                    >
                                        Group nearby places
                                    </label>
                                    <p className="mt-0.5 text-cp-11.5 text-cp-ink-3">
                                        On, nearby places share one bubble until you zoom in; off, every place is drawn.
                                    </p>
                                </div>
                                <Switch.Root
                                    id="cpSettingsClusters"
                                    checked={clusters}
                                    onCheckedChange={onClusters}
                                    className="relative h-6 w-11 shrink-0 rounded-full border border-cp-hairline bg-cp-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-cp-focus focus-visible:ring-offset-2 focus-visible:ring-offset-cp-surface-1 data-[state=checked]:bg-cp-accent-solid"
                                >
                                    <Switch.Thumb className="block h-5 w-5 translate-x-px rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.35)] transition-transform data-[state=checked]:translate-x-[21px]" />
                                </Switch.Root>
                            </div>
                        </section>

                        <section aria-labelledby="cpSettingsTextSize">
                            <div className="flex items-baseline justify-between gap-3">
                                <h2 id="cpSettingsTextSize" className="text-cp-13 font-semibold">
                                    Text size
                                </h2>
                                <span className="text-cp-11.5 text-cp-ink-3 tabular-nums">
                                    {textSize} px{textSize === TEXT_SIZE_DEFAULT ? ' · default' : ''}
                                </span>
                            </div>
                            <Slider.Root
                                value={[textSize]}
                                min={TEXT_SIZE_MIN}
                                max={TEXT_SIZE_MAX}
                                step={TEXT_SIZE_STEP}
                                onValueChange={([value]) => {
                                    if (value !== undefined) onTextSize(value)
                                }}
                                className="relative mt-3 flex h-5 w-full touch-none items-center select-none"
                            >
                                <Slider.Track className="relative h-1.5 grow rounded-full bg-cp-surface-3">
                                    <Slider.Range className="absolute h-full rounded-full bg-cp-accent-solid" />
                                </Slider.Track>
                                <Slider.Thumb
                                    aria-label="Text size"
                                    aria-valuetext={`${textSize} pixels`}
                                    className="block h-5 w-5 rounded-full border-2 border-cp-surface-1 bg-cp-accent-solid shadow-[0_1px_3px_rgba(0,0,0,.35)] outline-none focus-visible:ring-2 focus-visible:ring-cp-focus"
                                />
                            </Slider.Root>
                            <div className="mt-1 flex items-center justify-between text-cp-10.5 text-cp-ink-3 tabular-nums">
                                <span aria-hidden="true">{TEXT_SIZE_MIN} px</span>
                                {textSize !== TEXT_SIZE_DEFAULT ? (
                                    <button
                                        type="button"
                                        onClick={() => onTextSize(TEXT_SIZE_DEFAULT)}
                                        className="text-cp-accent hover:underline"
                                    >
                                        Reset to {TEXT_SIZE_DEFAULT} px
                                    </button>
                                ) : null}
                                <span aria-hidden="true">{TEXT_SIZE_MAX} px</span>
                            </div>
                        </section>
                    </div>

                    <div className="flex justify-end pt-5">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded-cp-control bg-cp-accent-solid px-3.5 py-2 text-cp-12.5 font-semibold text-cp-accent-ink"
                            >
                                Done
                            </button>
                        </Dialog.Close>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

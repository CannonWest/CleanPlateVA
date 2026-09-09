/**
 * The settings dialog (2026-09-06, Cannon's call) — the site's presentation
 * choices in one place, Radix primitives dressed in the theme's tokens:
 * the THEME as a three-way group (Light · Dark · System, the segmented
 * idiom of the band's view switcher), GROUP NEARBY PLACES as a two-picture
 * choice (the two map states drawn in the map's own marker vocabulary, the
 * current one lit and the other faded — Cannon's ask on the first look,
 * replacing a plain switch), and the TEXT SIZE as a slider over the body
 * size in px (settings.ts). The copy is the title and three short labels:
 * the lede and the System hint were cut on that same review. Every change
 * applies as it is made and is kept on the device — the App owns the state
 * and the storage; this component only asks. It opens on its own once, on
 * a visitor's first map view after the acknowledgement, and from the
 * Settings button under the band (map view only) any later time. An
 * ordinary dialog: ✕, backdrop, Escape and Done all close it; nothing here
 * is a decision (§6.1's dialog is the one with a fork).
 *
 * Radix does the mechanics — the portal, the focus trap and its return,
 * the scroll lock, aria-modal-by-aria-hidden / labelledby, the groups'
 * roving focus and radio semantics, the slider's pointer and arrow-key
 * handling — so this file is markup and two small pictures. Below `sm` it
 * is a bottom sheet, as the acknowledgement dialog is.
 */

import { Monitor, Moon, Sun, X } from 'lucide-react'
import { Dialog, Slider, ToggleGroup } from 'radix-ui'
import type { ThemeChoice } from './theme'
import { GRADE_PALETTES, STACK_INK, STACK_SURFACE } from './constants'
import type { GradePalette } from './constants'
import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from './settings'

/** The two ramps in display order; the labels are the public words. */
export const PALETTE_OPTIONS: ReadonlyArray<{ value: GradePalette; label: string }> = [
    { value: 'standard', label: 'Standard' },
    { value: 'colorblind', label: 'Color-blind friendly' },
]

const GRADE_LETTERS = ['A', 'B', 'C', 'D', 'F'] as const

/** A ramp's five grade chips in ITS colors — the literal hex from the table,
 *  never the live tokens, so each option shows its own ramp whichever one
 *  is on. The band's chip idiom (26px, rounded, the bold white letter);
 *  hidden from the accessible name, which the caption carries alone. */
function Ramp({ palette }: { palette: GradePalette }) {
    return (
        <span className="flex items-center gap-1" aria-hidden="true">
            {GRADE_LETTERS.map((letter) => (
                <span
                    key={letter}
                    className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] text-cp-11.5 font-bold text-white"
                    style={{ background: GRADE_PALETTES[palette][letter] }}
                >
                    {letter}
                </span>
            ))}
        </span>
    )
}

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

/** The two pictures' shared cast, in the map's vocabulary: nine places on a
 *  160×80 basemap tint — seven close together on the left, two apart on the
 *  right. The first picture draws all nine as dots; the second folds the
 *  seven into one donut (its arcs the grade breakdown, its hole the count)
 *  and keeps the two. Whole class strings — Tailwind scans source text. */
type Dot = readonly [cx: number, cy: number, fill: string]
const NEAR_DOTS: readonly Dot[] = [
    [40, 26, 'fill-cp-grade-a'], [60, 20, 'fill-cp-grade-a'], [78, 30, 'fill-cp-grade-c'],
    [44, 50, 'fill-cp-grade-a'], [66, 46, 'fill-cp-grade-b'], [52, 64, 'fill-cp-grade-a'],
    [76, 60, 'fill-cp-grade-b'],
]
const FAR_DOTS: readonly Dot[] = [
    [120, 24, 'fill-cp-grade-a'], [136, 58, 'fill-cp-grade-b'],
]
/** The donut's arcs — the seven near places by grade, clockwise from 12
 *  o'clock as the map paints them (donut.ts). */
const DONUT_ARCS: ReadonlyArray<readonly [stroke: string, places: number]> = [
    ['stroke-cp-grade-a', 4], ['stroke-cp-grade-b', 2], ['stroke-cp-grade-c', 1],
]
const DONUT = { cx: 58, cy: 42, r: 16, width: 5, gap: 1.5 } as const
const DOT_R = 5.5

function Ground() {
    return <rect width="160" height="80" rx="6" className="fill-cp-basemap" />
}

function Dots({ dots }: { dots: readonly Dot[] }) {
    return (
        <>
            {dots.map(([cx, cy, fill]) => (
                <circle
                    key={`${cx},${cy}`}
                    cx={cx}
                    cy={cy}
                    r={DOT_R}
                    className={`${fill} stroke-cp-marker-ring`}
                    strokeWidth="1.5"
                />
            ))}
        </>
    )
}

/** "Every place": all nine dots. */
export function EveryPlacePicture() {
    return (
        <svg viewBox="0 0 160 80" className="h-auto w-full" aria-hidden="true">
            <Ground />
            <Dots dots={NEAR_DOTS} />
            <Dots dots={FAR_DOTS} />
        </svg>
    )
}

/** "Grouped": the seven near places as one donut, the two far ones as dots. */
export function GroupedPicture() {
    const total = DONUT_ARCS.reduce((sum, [, places]) => sum + places, 0)
    let start = 0
    return (
        <svg viewBox="0 0 160 80" className="h-auto w-full" aria-hidden="true">
            <Ground />
            {/* The hole, reaching under the arcs so the gaps between them
                read as separators in the hole's own surface (donut.ts). */}
            <circle cx={DONUT.cx} cy={DONUT.cy} r={DONUT.r + DONUT.width / 2} fill={STACK_SURFACE} />
            {DONUT_ARCS.map(([stroke, places]) => {
                const length = (places / total) * 100
                const arc = (
                    <circle
                        key={stroke}
                        cx={DONUT.cx}
                        cy={DONUT.cy}
                        r={DONUT.r}
                        pathLength={100}
                        fill="none"
                        className={stroke}
                        strokeWidth={DONUT.width}
                        strokeDasharray={`${length - DONUT.gap} ${100 - length + DONUT.gap}`}
                        strokeDashoffset={-start}
                        transform={`rotate(-90 ${DONUT.cx} ${DONUT.cy})`}
                    />
                )
                start += length
                return arc
            })}
            <text
                x={DONUT.cx}
                y={DONUT.cy + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={STACK_INK}
            >
                {total}
            </text>
            <Dots dots={FAR_DOTS} />
        </svg>
    )
}

const PICTURE_ITEM = 'flex flex-1 flex-col items-center gap-1.5 rounded-cp-control border-2 border-cp-hairline '
    + 'bg-cp-surface-2 p-2 text-cp-11.5 font-semibold text-cp-ink-2 outline-none transition-opacity '
    + 'hover:opacity-100 focus-visible:ring-2 focus-visible:ring-cp-focus '
    + 'data-[state=off]:opacity-50 data-[state=on]:border-cp-accent-solid data-[state=on]:text-cp-ink'

export function SettingsDialog({
    open, onOpenChange, theme, palette, clusters, textSize, onTheme, onPalette, onClusters, onTextSize,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    theme: ThemeChoice
    palette: GradePalette
    clusters: boolean
    textSize: number
    onTheme: (choice: ThemeChoice) => void
    onPalette: (palette: GradePalette) => void
    onClusters: (on: boolean) => void
    onTextSize: (size: number) => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-cp-scrim backdrop-blur-[2px]" />
                <Dialog.Content
                    // No lede (Cannon's cut): the title alone names the dialog.
                    aria-describedby={undefined}
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
                    <Dialog.Title className="sr-only">
                        Settings
                    </Dialog.Title>

                    <div className="flex flex-col gap-5">
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
                                aria-labelledby="cpSettingsTheme"
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
                        </section>

                        <section aria-labelledby="cpSettingsPalette">
                            <h2 id="cpSettingsPalette" className="text-cp-13 font-semibold">
                                Grade colors
                            </h2>
                            <ToggleGroup.Root
                                type="single"
                                value={palette}
                                onValueChange={(value) => {
                                    if (value) onPalette(value as GradePalette)
                                }}
                                aria-labelledby="cpSettingsPalette"
                                className="mt-2 flex gap-2"
                            >
                                {PALETTE_OPTIONS.map(({ value, label }) => (
                                    <ToggleGroup.Item key={value} value={value} className={PICTURE_ITEM}>
                                        <Ramp palette={value} />
                                        <span>{label}</span>
                                    </ToggleGroup.Item>
                                ))}
                            </ToggleGroup.Root>
                        </section>

                        <section aria-labelledby="cpSettingsClusters">
                            <h2 id="cpSettingsClusters" className="text-cp-13 font-semibold">
                                Group nearby places
                            </h2>
                            <ToggleGroup.Root
                                type="single"
                                value={clusters ? 'on' : 'off'}
                                onValueChange={(value) => {
                                    if (value) onClusters(value === 'on')
                                }}
                                aria-labelledby="cpSettingsClusters"
                                className="mt-2 flex gap-2"
                            >
                                <ToggleGroup.Item value="off" className={PICTURE_ITEM}>
                                    <EveryPlacePicture />
                                    <span>Individual</span>
                                </ToggleGroup.Item>
                                <ToggleGroup.Item value="on" className={PICTURE_ITEM}>
                                    <GroupedPicture />
                                    <span>Grouped</span>
                                </ToggleGroup.Item>
                            </ToggleGroup.Root>
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
                            <div className="mt-2.5 flex items-baseline justify-between px-0.5 text-cp-ink-2 select-none" aria-hidden="true">
                                <span
                                    style={{ fontSize: `${TEXT_SIZE_MIN}px` }}
                                    className="cursor-pointer font-medium leading-none hover:text-cp-accent"
                                    onClick={() => onTextSize(TEXT_SIZE_MIN)}
                                >
                                    Abc
                                </span>
                                <span
                                    style={{ fontSize: `${TEXT_SIZE_DEFAULT}px` }}
                                    className="cursor-pointer font-medium leading-none hover:text-cp-accent"
                                    onClick={() => onTextSize(TEXT_SIZE_DEFAULT)}
                                >
                                    Abc
                                </span>
                                <span
                                    style={{ fontSize: `${TEXT_SIZE_MAX}px` }}
                                    className="cursor-pointer font-medium leading-none hover:text-cp-accent"
                                    onClick={() => onTextSize(TEXT_SIZE_MAX)}
                                >
                                    Abc
                                </span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between text-cp-10.5 text-cp-ink-3 tabular-nums">
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

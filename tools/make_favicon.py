"""Render the site icons from the brand mark — the one source of truth.

    python tools/make_favicon.py

Writes, from app/clean-plate-va-logo.png:

  public/favicon.ico          16 + 32 + 48, rounded dark tile, transparent
                              outside the corner radius (it reads as a chip
                              in the tab strip)
  public/apple-touch-icon.png 180x180, FULL-BLEED opaque square — iOS applies
                              its own squircle mask and composites anything
                              transparent onto black, so rounding it here
                              would double-round it

Both land in public/ rather than riding the Vite asset pipeline: a favicon
needs a stable, predictable name. Browsers probe /favicon.ico bare and iOS
probes /apple-touch-icon.png bare, and neither would ever find a
content-hashed dist/assets/ name. public/** is copied verbatim into dist/
(vite.config.ts closeBundle, everything but data-full/**), so these ship at
the root and the assets layer answers them without a Worker request.

Why the tile at all (Cannon's call, 2026-09-06): the mark is a white plate,
and Chrome's light tab strip is near-white — untiled, the plate vanishes at
16px and the icon is an orange smear. The dark tile is --cp-surface-1's dark
value, so the icon reads as the app's own chrome.

Re-run this after any edit to the brand mark and commit what changes; nothing
in the build regenerates it.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app" / "clean-plate-va-logo.png"
ICO = ROOT / "public" / "favicon.ico"
APPLE = ROOT / "public" / "apple-touch-icon.png"

# --cp-surface-1, dark (app/theme.css). The mark's own palette is unchanged.
TILE = (0x16, 0x19, 0x1C, 0xFF)

ICO_SIZES = [(48, 48), (32, 32), (16, 16)]
APPLE_SIZE = 180

# The master is drawn large and downsampled once per size, so the corner
# radius and the mark both land antialiased rather than aliased at 16px.
MASTER = 1024
INSET = 0.10  # the mark's breathing room inside the tile
RADIUS = 0.22  # corner radius, as a fraction of the side


def squared_mark(margin: float = 0.04) -> Image.Image:
    """The mark trimmed to its alpha bbox and re-squared with a hair of
    margin. The source PNG carries ~10% dead transparent border on every
    side; at 16px that padding is the difference between a legible plate
    and a smudge."""
    art = Image.open(SOURCE).convert("RGBA")
    mark = art.crop(art.getchannel("A").getbbox())
    side = round(max(mark.size) * (1 + margin * 2))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)
    return out


def tile(mark: Image.Image, *, rounded: bool) -> Image.Image:
    """The mark inset on a MASTER-square tile, rounded for the tab strip and
    square for iOS."""
    plate = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(plate)
    if rounded:
        draw.rounded_rectangle((0, 0, MASTER - 1, MASTER - 1),
                               radius=round(MASTER * RADIUS), fill=TILE)
    else:
        draw.rectangle((0, 0, MASTER - 1, MASTER - 1), fill=TILE)
    pad = round(MASTER * INSET)
    inner = mark.resize((MASTER - pad * 2, MASTER - pad * 2), Image.LANCZOS)
    plate.paste(inner, (pad, pad), inner)
    return plate


def main() -> None:
    mark = squared_mark()

    chip = tile(mark, rounded=True)
    # Pre-render each size from the master rather than letting the ICO writer
    # thumbnail once — save() would resize from the same master anyway, but
    # naming the frames here keeps the emitted set explicit and testable.
    frames = [chip.resize(size, Image.LANCZOS) for size in ICO_SIZES]
    frames[0].save(ICO, format="ICO", sizes=ICO_SIZES,
                   append_images=frames[1:])

    tile(mark, rounded=False).resize((APPLE_SIZE, APPLE_SIZE), Image.LANCZOS).save(APPLE)

    for path in (ICO, APPLE):
        print(f"wrote {path.relative_to(ROOT).as_posix()}  {path.stat().st_size:,}B")


if __name__ == "__main__":
    main()

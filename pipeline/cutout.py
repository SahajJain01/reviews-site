# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["rembg[cpu]>=2.0.60", "pillow>=10", "pillow-heif>=0.18"]
# ///
"""Make cutouts for pending photos.

Usage: uv run pipeline/cutout.py .cache/pending.json cutouts/

pending.json: [{"key": str, "src": abs path, "cutout": bool, "file": note path}]
Writes cutouts/<key>.png (background removed, trimmed) or cutouts/<key>.jpg (cutout: false),
and merges {key: {file, width, height, tint}} into cutouts/manifest.json.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:  # pragma: no cover - optional
    pass

MODEL = "birefnet-general-lite"
LONG_EDGE = 1600
MARGIN = 0.03  # transparent margin around the trimmed cutout, as a fraction of the long edge


def lighten(rgb, amount=0.82):
    return "#" + "".join(f"{round(c + (255 - c) * amount):02x}" for c in rgb)


def avg_colour(img, mask=None):
    from PIL import ImageStat

    small = img.convert("RGB").resize((64, 64))
    m = mask.resize((64, 64)).point(lambda a: 255 if a >= 128 else 0) if mask is not None else None
    if m is not None and m.getbbox() is None:
        return (240, 238, 234)
    return tuple(int(c) for c in ImageStat.Stat(small, m).mean)


def cap(img):
    if max(img.size) > LONG_EDGE:
        img.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
    return img


def main(pending_path, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    pending = json.loads(Path(pending_path).read_text())
    todo = [p for p in pending if p["key"] not in manifest]
    if not todo:
        print("nothing to do")
        return

    session = None
    for p in todo:
        src = ImageOps.exif_transpose(Image.open(p["src"]))
        if p["cutout"]:
            if session is None:
                from rembg import new_session

                session = new_session(MODEL)
            from rembg import remove

            work = src.convert("RGB")
            work.thumbnail((2048, 2048), Image.LANCZOS)
            rgba = remove(work, session=session)
            alpha = rgba.getchannel("A")
            bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
            if bbox is None:
                raise SystemExit(f"{p['file']}: background removal found no object in the photo; set `cutout: false` or reshoot")
            rgba = rgba.crop(bbox)
            pad = round(max(rgba.size) * MARGIN)
            canvas = Image.new("RGBA", (rgba.width + 2 * pad, rgba.height + 2 * pad), (0, 0, 0, 0))
            canvas.paste(rgba, (pad, pad))
            canvas = cap(canvas)
            tint = lighten(avg_colour(canvas, canvas.getchannel("A")))
            name = f"{p['key']}.png"
            canvas.save(out / name, optimize=True)
            w, h = canvas.size
        else:
            img = cap(src.convert("RGB"))
            tint = lighten(avg_colour(img))
            name = f"{p['key']}.jpg"
            img.save(out / name, quality=88, optimize=True, progressive=True)
            w, h = img.size
        manifest[p["key"]] = {"file": name, "width": w, "height": h, "tint": tint}
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        print(f"{p['file']} -> {name} ({w}x{h}, tint {tint})", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

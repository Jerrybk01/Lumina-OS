"""Build Lumina-OS-portable.zip, write icon.ico, and refresh the Desktop shortcut."""
import os
import struct
import subprocess
import zlib
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
out = root / "Lumina-OS-portable.zip"
desk = Path(os.path.expanduser(r"~\Desktop\Lumina-OS-portable.zip"))


def _png(width, height, pixels):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in pixels)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def _mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _paint(size):
    ink, core, ring, glow = (12, 14, 18), (242, 230, 201), (126, 200, 200), (232, 164, 92)
    rows = []
    cx = cy = (size - 1) / 2
    r_out = size * 0.44
    r_core = size * 0.36
    r_hot = size * 0.09
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d > r_out + 1.2:
                row.extend((0, 0, 0, 0))
                continue
            t = max(0.0, min(1.0, 1 - d / r_core))
            rgb = _mix(ink, core, t * 0.92)
            if d < r_hot:
                rgb = _mix(rgb, (247, 243, 234), 0.85)
            elif dy < 0 and d < r_core:
                rgb = _mix(rgb, ring, 0.28)
            elif dy > r_core * 0.25:
                rgb = _mix(rgb, glow, 0.22)
            alpha = 255 if d <= r_out else int(max(0, 1 - (d - r_out)) * 255)
            row.extend((*rgb, alpha))
        rows.append(bytes(row))
    return rows


def write_icon(path: Path):
    sizes = (16, 32, 48, 256)
    pngs = [_png(s, s, _paint(s)) for s in sizes]
    offset = 6 + 16 * len(sizes)
    buf = bytearray(struct.pack("<HHH", 0, 1, len(sizes)))
    for size, png in zip(sizes, pngs):
        buf += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
    for png in pngs:
        buf += png
    path.write_bytes(buf)


write_icon(root / "icon.ico")

include = [
    "index.html",
    "pinokio.js",
    "pinokio.json",
    "icon.svg",
    "icon.ico",
    "README.md",
    ".gitignore",
    "start.bat",
    "serve.ps1",
    "launch.vbs",
    "create-desktop-icon.ps1",
    "START.txt",
    "guide.html",
    "USER-GUIDE.md",
]

assets = sorted(
    p
    for p in (root / "assets").rglob("*")
    if p.is_file() and p.suffix.lower() in {".js", ".css", ".svg", ".png", ".jpg", ".webp", ".woff", ".woff2"}
)

missing = [n for n in include if not (root / n).is_file()]
if missing:
    raise SystemExit("missing files: " + ", ".join(missing))

if out.exists():
    out.unlink()

with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for name in include:
        z.write(root / name, f"Lumina-OS/{name}")
    for p in assets:
        z.write(p, "Lumina-OS/" + p.relative_to(root).as_posix())

desk.parent.mkdir(parents=True, exist_ok=True)
try:
    desk.write_bytes(out.read_bytes())
except OSError:
    pass

icon_script = root / "create-desktop-icon.ps1"
subprocess.run(
    [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(icon_script),
    ],
    check=False,
)

print("zip:", out, out.stat().st_size)
if desk.is_file():
    print("desk:", desk, desk.stat().st_size)
with zipfile.ZipFile(out) as z:
    for n in z.namelist():
        print(n)

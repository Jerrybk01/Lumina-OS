"""Download the official SadTalker 256px models used by the local studio."""
from pathlib import Path
from urllib.request import Request, urlopen


SADTALKER_RELEASE = "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/"
GFPGAN_RELEASE = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/"
FACEXLIB_RELEASE = "https://github.com/xinntao/facexlib/releases/download/v0.2.2/"
CHECKPOINTS = Path(__file__).resolve().parent / "SadTalker" / "checkpoints"
FILES = (
    (CHECKPOINTS, SADTALKER_RELEASE, "mapping_00109-model.pth.tar"),
    (CHECKPOINTS, SADTALKER_RELEASE, "mapping_00229-model.pth.tar"),
    (CHECKPOINTS, SADTALKER_RELEASE, "SadTalker_V0.0.2_256.safetensors"),
    (CHECKPOINTS, SADTALKER_RELEASE, "SadTalker_V0.0.2_512.safetensors"),
    (Path(__file__).resolve().parent / "SadTalker" / "gfpgan" / "weights", GFPGAN_RELEASE, "GFPGANv1.4.pth"),
    (Path(__file__).resolve().parent / "SadTalker" / "gfpgan" / "weights", FACEXLIB_RELEASE, "parsing_parsenet.pth"),
)


def fetch(folder: Path, base_url: str, filename: str) -> None:
    target = folder / filename
    if target.exists() and target.stat().st_size > 1_000_000:
        print(f"Already downloaded: {filename}", flush=True)
        return

    folder.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    request = Request(base_url + filename, headers={"User-Agent": "Lumina-OS-avatar-studio"})
    print(f"Downloading {filename} from the official SadTalker release…", flush=True)
    with urlopen(request, timeout=60) as response, partial.open("wb") as output:
        total = int(response.headers.get("Content-Length", 0))
        downloaded = 0
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            downloaded += len(chunk)
            if total:
                print(f"  {downloaded / total:.0%}", flush=True)
    if partial.stat().st_size < 1_000_000:
        raise RuntimeError(f"Download was unexpectedly small: {filename}")
    partial.replace(target)


def main() -> None:
    for folder, base_url, filename in FILES:
        fetch(folder, base_url, filename)


if __name__ == "__main__":
    main()

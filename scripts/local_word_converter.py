from __future__ import annotations

import argparse
import subprocess
import tempfile
import time
from pathlib import Path


POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"


def convert(request_path: Path) -> None:
    response_path = request_path.with_suffix(".pdf")
    error_path = request_path.with_suffix(".error")
    with tempfile.TemporaryDirectory(prefix="aromazen-word-converter-") as temporary:
        workdir = Path(temporary)
        output_path = workdir / "appointment.pdf"
        script_path = workdir / "convert.ps1"
        script_path.write_text(
            """param([string]$InputDocx, [string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $document = $word.Documents.Open($InputDocx, $false, $true)
  try { $document.ExportAsFixedFormat($OutputPdf, 17) } finally { $document.Close($false) }
} finally { try { $word.Quit() } catch {} }
""",
            encoding="utf-8-sig",
        )
        result = subprocess.run(
            [
                POWERSHELL,
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                str(request_path.resolve()),
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode == 0 and output_path.is_file():
            response_path.write_bytes(output_path.read_bytes())
        else:
            error_path.write_text(result.stderr[-2000:] or "Microsoft Word conversion failed", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    print(f"Aromazen Word converter watching {directory}", flush=True)
    while True:
        for request_path in directory.glob("*.docx"):
            if request_path.with_suffix(".pdf").exists() or request_path.with_suffix(".error").exists():
                continue
            try:
                convert(request_path)
            except Exception as error:
                request_path.with_suffix(".error").write_text(str(error), encoding="utf-8")
        time.sleep(0.2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Syntax-check inline JavaScript in the static website pages with Node."""
import re
import subprocess
import tempfile
from pathlib import Path

FILES = ["index.html", "admin.html", "membership.html"]
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
failures = []
checked = 0
with tempfile.TemporaryDirectory(prefix="fqmma-js-check-") as tmp:
    for filename in FILES:
        html = Path(filename).read_text(encoding="utf-8")
        for index, (attrs, source) in enumerate(SCRIPT_RE.findall(html), start=1):
            if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE):
                continue
            script_type = re.search(r"""\btype\s*=\s*["']([^"']+)["']""", attrs, re.IGNORECASE)
            if script_type and script_type.group(1).lower() not in ("text/javascript", "application/javascript", "module"):
                continue
            path = Path(tmp) / f"{Path(filename).stem}-{index}.js"
            path.write_text(source, encoding="utf-8")
            result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
            checked += 1
            if result.returncode:
                failures.append(f"{filename} inline script #{index}:\n{result.stderr}")
if failures:
    print("\n\n".join(failures))
    raise SystemExit(1)
print(f"JavaScript syntax check passed for {checked} inline script(s).")

#!/usr/bin/env python3
"""Static checks for the ABDM legacy add-on.

It verifies that:

* every ``&entity;`` used in a XUL file is defined in the DTD referenced by its
  DOCTYPE (a missing entity breaks the window at parse time), and
* every string-bundle key used from JavaScript exists in the matching
  ``.properties`` file.

As an extra check, if ``xmllint`` is available the XUL files are parsed against
their DTDs with ``--loaddtd`` so XML well-formedness is validated too.

Usage: python3 tools/check_locales.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content"
LOCALE = ROOT / "src" / "locale" / "en-US"

BUILTIN_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}

ENTITY_USED = re.compile(r"&([A-Za-z_][\w.\-]*);")
ENTITY_DEFINED = re.compile(r"<!ENTITY\s+([A-Za-z_][\w.\-]*)\s+")
DTD_IN_DOCTYPE = re.compile(r"chrome://abdm_legacy/locale/([\w.\-]+)\.dtd")
BUNDLE_IN_JS = re.compile(r"chrome://abdm_legacy/locale/([\w.\-]+)\.properties")
STR_USED = re.compile(r'(?:_str|GetStringFromName)\(\s*"([^"]+)"')

errors: list[str] = []


def strip_comments_and_scripts(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<script\b.*?</script>", "", text, flags=re.S | re.I)
    return text


def check_xul(xul: Path) -> None:
    raw = xul.read_text(encoding="utf-8")
    match = DTD_IN_DOCTYPE.search(raw)
    if not match:
        return
    dtd = LOCALE / f"{match.group(1)}.dtd"
    rel = xul.relative_to(ROOT)
    if not dtd.is_file():
        errors.append(f"{rel}: referenced DTD not found: {dtd.relative_to(ROOT)}")
        return

    used = set(ENTITY_USED.findall(strip_comments_and_scripts(raw))) - BUILTIN_ENTITIES
    defined = set(ENTITY_DEFINED.findall(dtd.read_text(encoding="utf-8")))

    missing = sorted(used - defined)
    if missing:
        errors.append(f"{rel}: entities not defined in {dtd.name}: {missing}")

    # Validate XML + entity resolution with xmllint when available.
    xmllint = shutil.which("xmllint")
    if xmllint:
        with tempfile.NamedTemporaryFile("w", suffix=".xul", delete=False) as fh:
            fh.write(raw.replace(f"chrome://abdm_legacy/locale/{match.group(1)}.dtd", str(dtd)))
            tmp = Path(fh.name)
        try:
            result = subprocess.run(
                [xmllint, "--noout", "--loaddtd", str(tmp)],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                errors.append(f"{rel}: xmllint failed:\n{result.stderr.strip()}")
        finally:
            tmp.unlink(missing_ok=True)


def check_js(js: Path) -> None:
    raw = js.read_text(encoding="utf-8")
    match = BUNDLE_IN_JS.search(raw)
    if not match:
        return
    props = LOCALE / f"{match.group(1)}.properties"
    rel = js.relative_to(ROOT)
    if not props.is_file():
        errors.append(f"{rel}: referenced bundle not found: {props.relative_to(ROOT)}")
        return

    used = set(STR_USED.findall(raw))
    defined = set()
    for line in props.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line[0] in "#!" or "=" not in line:
            continue
        defined.add(line.split("=", 1)[0].strip())

    missing = sorted(used - defined)
    if missing:
        errors.append(f"{rel}: bundle keys not defined in {props.name}: {missing}")


def main() -> int:
    for xul in sorted(CONTENT.glob("*.xul")):
        check_xul(xul)
    for js in sorted(CONTENT.glob("*.js")):
        check_js(js)

    if errors:
        print("Locale check FAILED:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print("Locale check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

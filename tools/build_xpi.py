#!/usr/bin/env python3
"""
Build an XPI for AB Download Manager Legacy by zipping the contents of the source
directory (not the parent folder) using ZIP_STORED (no compression) and renaming
the archive to .xpi with the required filename pattern.

Usage:
  python tools/build_xpi.py [--src SRC_DIR] [--install-rdf INSTALL_RDF] [--out OUT_DIR] [--version VERSION]

By default the script reads version from `src/install.rdf` and packages `src/`.
"""

from __future__ import annotations

import argparse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

EM_RDF_NS = "http://www.mozilla.org/2004/em-rdf#"


def get_version_from_install_rdf(install_rdf_path: Path) -> str | None:
    if not install_rdf_path.exists():
        return None
    try:
        tree = ET.parse(install_rdf_path)
        root = tree.getroot()
        # Try to find em:version using namespace
        version_elem = root.find(f".//{{{EM_RDF_NS}}}version")
        if version_elem is not None and version_elem.text:
            return version_elem.text.strip()
        # Fallback: find any element named 'version'
        for elem in root.iter():
            if elem.tag.endswith("}version") or elem.tag == "version":
                if elem.text:
                    return elem.text.strip()
    except ET.ParseError:
        return None
    return None


def create_xpi_from_dir(src_dir: Path, out_file: Path) -> None:
    """Create a zip archive in STORE mode containing the contents of src_dir.

    Files will be stored with paths relative to src_dir, so the top-level folder
    itself is not present inside the archive.
    """
    src_dir = src_dir.resolve()
    if not src_dir.is_dir():
        raise SystemExit(f"Source directory does not exist: {src_dir}")

    compression = zipfile.ZIP_STORED
    out_file_parent = out_file.parent
    out_file_parent.mkdir(parents=True, exist_ok=True)

    # Determine repository root (assume tools/ is directly under repo root)
    repo_root = Path(__file__).resolve().parent.parent
    readme_path = repo_root / "README.md"

    with zipfile.ZipFile(out_file, mode="w", compression=compression) as zf:
        # First, write the contents of src/ (but skip any README.md inside src so
        # the repository README can be used as the extension README at archive root)
        for path in sorted(src_dir.rglob("*")):
            if path.is_file():
                # arcname: path relative to src_dir, use POSIX style inside zip
                arcname = path.relative_to(src_dir).as_posix()
                if arcname == "README.md":
                    # skip README in src/ to avoid duplicate/conflict
                    continue
                zf.write(path, arcname)

        # Then, include repository README.md at the archive root if available
        if readme_path.exists() and readme_path.is_file():
            try:
                zf.write(readme_path, "README.md")
            except Exception:
                # Non-fatal: if for some reason we can't add README, continue
                pass


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Create abdm XPI (store mode, no compression)"
    )
    p.add_argument(
        "--src", default="src", help="Source directory to package (default: src)"
    )
    p.add_argument(
        "--install-rdf",
        default=None,
        help="Path to install.rdf to read version from (default: <src>/install.rdf)",
    )
    p.add_argument(
        "--out", default=".", help="Output directory (default: current directory)"
    )
    p.add_argument("--version", default=None, help="Override version string")
    args = p.parse_args(argv)

    src_dir = Path(args.src)
    install_rdf = (
        Path(args.install_rdf) if args.install_rdf else src_dir / "install.rdf"
    )
    out_dir = Path(args.out)

    version = args.version or get_version_from_install_rdf(install_rdf)
    if not version:
        print(
            "ERROR: Could not determine version. Provide --version or ensure install.rdf contains <em:version>."
        )
        return 2

    filename = f"abdm-legacy-integration-{version}.xpi"
    out_file = out_dir / filename

    print(f"Packaging '{src_dir}' -> '{out_file}' (store, no compression)")
    create_xpi_from_dir(src_dir, out_file)
    print(f"Created: {out_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

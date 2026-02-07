#!/usr/bin/env python3
"""Orchestrate the pyutils/schools harvesting workflow.

Recommended order:
 1. ../harvest.py -- generates secondary_school_google_places.json
 2. fetch_portuguese_schools.py
 3. geographic_schools_search.py (heavy)
 4. direct_api_schools.py
 5. comprehensive_primary_schools.py
 6. find_missing_schools.py
 7. validate_and_merge_schools.py

Usage:
  python main.py [--skip-harvest] [--skip-geographic] [--skip-direct] [--skip-comprehensive]
                [--skip-find-missing] [--skip-validate]
                [--dry-run] [--continue-on-error]
"""
import argparse
import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Each step: script path (relative to BASE_DIR), description, optional args (list)
STEP_SCRIPTS = [
    # Run the parent harvest.py to generate Google Places dumps (e.g. secondary_school_google_places.json)
    # Run harvest from BASE_DIR and write output into the current folder ('.')
    {"script": "../harvest.py", "desc": "run harvest.py to produce secondary_school_google_places.json", "args": ["secondary_school", "-o", "."], "cwd": BASE_DIR},
    {"script": "fetch_portuguese_schools.py", "desc": "fetch OSM + parse existing Google dataset", "args": ["--input", "secondary_school_google_places.json"]},
    {"script": "geographic_schools_search.py", "desc": "comprehensive geographic search (heavy)"},
    {"script": "direct_api_schools.py", "desc": "supplementary direct API queries"},
    {"script": "comprehensive_primary_schools.py", "desc": "generate primary set from Google dump", "args": ["--input", "secondary_school_google_places.json"]},
    {"script": "find_missing_schools.py", "desc": "targeted/text searches for missing schools"},
    {"script": "validate_and_merge_schools.py", "desc": "final validation & merge into canonical datasets", "args": ["--primary", "primary_school.json", "--secondary", "secondary_school.json"]},
]

def run_script(script_path, args=None, dry_run=False, cwd=None):
    cmd = [sys.executable, script_path]
    if args:
        cmd += args
    print(f"→ Running: {cmd}")
    if dry_run:
        return 0
    proc = subprocess.run(cmd, cwd=cwd)
    return proc.returncode

def file_exists(path):
    return os.path.exists(path) and os.path.isfile(path)

def main():
    ap = argparse.ArgumentParser(description="Orchestrate schools harvesting scripts")
    ap.add_argument("--skip-harvest", action="store_true", help="Skip ../harvest.py")
    ap.add_argument("--skip-geographic", action="store_true", help="Skip geographic_schools_search.py (long-running)")
    ap.add_argument("--skip-direct", action="store_true", help="Skip direct_api_schools.py")
    ap.add_argument("--skip-comprehensive", action="store_true", help="Skip comprehensive_primary_schools.py")
    ap.add_argument("--skip-find-missing", action="store_true", help="Skip find_missing_schools.py")
    ap.add_argument("--skip-validate", action="store_true", help="Skip validate_and_merge_schools.py")
    ap.add_argument("--dry-run", action="store_true", help="Print commands without executing")
    ap.add_argument("--continue-on-error", action="store_true", help="Continue even if a step fails")
    args = ap.parse_args()

    skip_map = {
        "../harvest.py": args.skip_harvest,
        "geographic_schools_search.py": args.skip_geographic,
        "direct_api_schools.py": args.skip_direct,
        "comprehensive_primary_schools.py": args.skip_comprehensive,
        "find_missing_schools.py": args.skip_find_missing,
        "validate_and_merge_schools.py": args.skip_validate,
    }

    summary = []
    for step in STEP_SCRIPTS:
        script = step["script"]
        desc = step.get("desc", "")
        step_args = step.get("args", [])

        if skip_map.get(script, False):
            print(f"- Skipping {script} ({desc})")
            summary.append((script, "skipped"))
            continue

        script_path = os.path.normpath(os.path.join(BASE_DIR, script))
        if not file_exists(script_path):
            print(f"- Not found: {script_path} → skipping")
            summary.append((script, "missing"))
            if not args.continue_on_error:
                print("Exiting due to missing script.")
                sys.exit(1)
            continue

        print("\n" + "=" * 60)
        print(f"Running: {script} — {desc}")
        print("=" * 60)
        # Use step-specific cwd if provided, otherwise default to the script's directory
        run_cwd = step.get("cwd", os.path.dirname(script_path))
        # Ensure step_args is a list
        step_args = list(step_args) if step_args else []
        rc = run_script(script_path, args=step_args, dry_run=args.dry_run, cwd=run_cwd)
        if rc == 0:
            print(f"✓ {script} completed successfully")
            summary.append((script, "ok"))
        else:
            print(f"✗ {script} failed (return code {rc})")
            summary.append((script, f"failed:{rc}"))
            if not args.continue_on_error:
                print("Stopping pipeline due to failure.")
                sys.exit(rc)

    print("\n" + "=" * 60)
    print("Pipeline summary:")
    for script, status in summary:
        print(f" - {script}: {status}")
    print("=" * 60)

    sys.exit(0)

if __name__ == "__main__":
    main()
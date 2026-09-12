#!/usr/bin/env python3
"""Compatibility entry point for the unified event relationship builder."""

from __future__ import annotations

import sys

from update_events import main


if __name__ == "__main__":
    print(
        "gen_voice_part.py has been replaced by update_events.py; "
        "rebuilding the unified event and appearance indexes.",
        file=sys.stderr,
    )
    raise SystemExit(main())

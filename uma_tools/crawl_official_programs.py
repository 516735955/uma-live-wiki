#!/usr/bin/env python3
"""Refresh official program records through the canonical event builder.

This is a discoverable maintenance entry point, not a second crawler. All
matching, preservation, validation, and output logic remains in
``update_events.py``.
"""

from __future__ import annotations

import sys

from update_events import main


if __name__ == "__main__":
    raise SystemExit(main(["--refresh-programs", *sys.argv[1:]]))

#!/usr/bin/env python3
from pathlib import Path

STORY = Path("calvary-scribblings-next/app/stories/[slug]/page-client.js")
READER = Path("calvary-scribblings-next/app/reader/[slug]/page-reader.js")

PATCHES = []

# Story page — find a media query block to extend, or add one
s = STORY.read_text()
ANCHOR_S = "@media(max-width:600px){"
if "@media (max-width: 600px)" in s or "@media(max-width:600px){.cs-textarea" in s or "16px" in s.split(".cs-textarea")[1][:200]:
    pass  # check more carefully below

if ".cs-textarea, .cs-textarea-sm { font-size: 16px" in s:
    print("SKIP story: mobile zoom fix already present.")
else:
    # Find the closing `}` of the styled JSX and inject before it
    INJECT_S = "@media (max-width: 600px) { .cs-textarea, .cs-textarea-sm { font-size: 16px !important; } }\n        "
    # Insert before the closing of the <style> block
    marker = "        `}</style>"
    if marker in s:
        s = s.replace(marker, "        " + INJECT_S + "`}</style>", 1)
        STORY.write_text(s)
        print("OK story: mobile zoom fix added.")
    else:
        print("WARN story: style closing marker not found.")

# Reader
r = READER.read_text()
if ".cs-textarea, .cs-textarea-sm { font-size: 16px" in r or ".cs-textarea,.cs-textarea-sm{font-size:16px" in r:
    print("SKIP reader: mobile zoom fix already present.")
else:
    # Find a close marker — reader styles end with `}</style>` too
    INJECT_R = "@media(max-width:600px){.cs-textarea,.cs-textarea-sm{font-size:16px !important}}"
    marker = "      `}</style>"
    if marker in r:
        r = r.replace(marker, "        " + INJECT_R + "\n      `}</style>", 1)
        READER.write_text(r)
        print("OK reader: mobile zoom fix added.")
    else:
        print("WARN reader: style closing marker not found.")
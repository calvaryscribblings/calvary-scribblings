#!/usr/bin/env python3
from pathlib import Path

F = Path("calvary-scribblings-next/app/components/StoryAuthorBio.js")
c = F.read_text()

c = c.replace("`/user/${handle}`", "`/user?id=${authorUid}`")

F.write_text(c)
print("OK: handle and name links now go to /user?id={uid}")
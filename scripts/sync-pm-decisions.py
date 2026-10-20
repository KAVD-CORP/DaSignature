#!/usr/bin/env python3
"""Re-copies PM_DECISIONS.md (team folder) into docs/decisions.md section 1, verbatim."""
import pathlib, re, sys
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../PM_DECISIONS.md').read_text().splitlines()
items = [l for l in src[1:] if l.strip()]
last = max(int(m.group(1)) for l in items if (m := re.match(r'^(\d+)\.', l)))
doc = pathlib.Path('docs/decisions.md')
s = doc.read_text()
head, rest = s.split('## 1. PM decisions (copied verbatim)\n', 1)
_, tail = rest.split('\n## 2. ', 1)
body = (f"\nSource: `/home/box/shared/dasignature/PM_DECISIONS.md` ({src[0].lstrip('# ').strip()}), "
        f"re-copied at the latest milestone (items 1-{last}).\n\n" + '\n'.join(items) + '\n')
doc.write_text(head + '## 1. PM decisions (copied verbatim)\n' + body + '\n## 2. ' + tail)
print(f'copied {len(items)} lines, items 1-{last}')

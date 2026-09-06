#!/usr/bin/env python3
"""
fix-wordmath.py — convert verbalized math ("fourth root x squared root",
"2raised to x power", "fraction with numerator a , denominator b") inside
\\(...\\) segments of the curated records into real LaTeX.

College Board's alttext transcriptions landed verbatim in the curation
workbook and from there in research/sat/curated/ssqb-*.json; KaTeX rendered
the words as mangled italics ("fourthrootx²+8x+16root"). The converter lives
in scripts/lib/wordmath.py and is also applied by import-curated.py, so this
one-shot script only needs to repair the EXISTING records.

Rewrites research/sat/curated/ssqb-*.json in place (review blocks and all
non-text fields are preserved), then prints a report. Afterwards push the
fixed records to Supabase with:

    npm run seed:curated

Exit 0.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / 'lib'))

from wordmath import clean_text, residuals, MATH_SEG_RE  # noqa: E402

CURATED = ROOT / 'research' / 'sat' / 'curated'

TEXT_FIELDS = ('info', 'prompt', 'rationale', 'gridAnswer')

# Hand-verified repairs for damage no rule can safely reconstruct. Keyed by
# (sourceId, field) — 'optA'..'optD' address options. Each (old, new) pair is
# applied verbatim before the generic cleanup.
OVERRIDES: dict[tuple[str, str], list[tuple[str, str]]] = {
    ('ssqb-e117d3b8', 'rationale'): [
        (r'By rewriting \((a + c)^{4}\) as (\((a + c)^{2}\))\(^{2}, it is',
         r'By rewriting \((a + c)^{4}\) as \(( ( a + c )^{2} )^{2}\), it is'),
    ],
    ('ssqb-0ef4a7b6', 'rationale'): [
        (r'The inequality \(106 Choice B is incorrect.',
         r'The inequality \(h > 100\). Choice B is incorrect.'),
    ],
    ('ssqb-fc3dfa26', 'rationale'): [
        (r'by \(^{\(\frac{x - 3}{x - 3}\)} yields',
         r'by \(\frac{x - 3}{x - 3}\) yields'),
    ],
    ('ssqb-d41cf4d3', 'rationale'): [
        (r'it follows that \(a Choice A is incorrect.',
         r'it follows that \(a<b\). Choice A is incorrect.'),
    ],
    ('ssqb-d41cf4d3', 'optD'): [
        (r'\(a', r'\(a<b\)'),
    ],
    ('ssqb-dc71597b', 'rationale'): [
        (r'\sqrt{\frac{a}}{b = \frac{\sqrt{a}}{\sqrt{b}}}',
         r'\sqrt{\frac{a}{b}} = \frac{\sqrt{a}}{\sqrt{b}}'),
    ],
    ('ssqb-7bf77c19', 'prompt'): [
        (r'such that \(axy-plane, which of the following',
         r'such that \(a > 0\). In the *xy*-plane, which of the following'),
    ],
    ('ssqb-7bf77c19', 'rationale'): [
        (r'such that \(ay-coordinate of the *y*-intercept of the graph of a function is the value of the function when \(x=0\)',
         r'such that \(a > 0\). The *y*-coordinate of the *y*-intercept of the graph of a function is the value of the function when \(x = 0\)'),
    ],
    ('ssqb-5bf5136d', 'rationale'): [
        (r'ty \(6 Choice A is incorrect.',
         r'ty \(6<x<18\) represents all possible values of \(x\). Choice A is incorrect.'),
    ],
    ('ssqb-5bf5136d', 'optC'): [
        (r'\(6', r'\(6<x<18\)'),
    ],
}

# Records whose question-critical content was lost at harvest (the expression
# the question is about is missing from both the curated and the raw record).
# Marked review.status='returned' so they leave the simulator pools until a
# curator re-enters them from the source workbook.
RETURNED: dict[str, str] = {
    'ssqb-ecca0603': 'prompt is missing one inequality of the system (harvest content loss)',
    'ssqb-a1696f3e': 'function definition missing from prompt (harvest content loss)',
    'ssqb-c81b6c57': 'expression containing p missing from prompt (harvest content loss)',
    'ssqb-7392dfc1': 'expression the question asks about missing (harvest content loss)',
    'ssqb-1e1027a7': 'a t-value is missing from the choice-A rationale (harvest content loss)',
    'ssqb-781c2f6e': 'question wording garbled at harvest (missing "a > 0" clause and lead-in)',
}


def clean_record(rec: dict) -> tuple[dict, int]:
    """Return (record with cleaned text fields, number of fields changed)."""
    changed = 0
    out = dict(rec)
    sid = out.get('sourceId', '')

    def prep(field: str, v: str) -> str:
        for old, new in OVERRIDES.get((sid, field), []):
            if old in v:
                v = v.replace(old, new)
        return v

    for field in TEXT_FIELDS:
        v = out.get(field)
        if isinstance(v, str) and v:
            nv = clean_text(prep(field, v))
            if nv != v:
                out[field] = nv
                changed += 1
    opts = out.get('options')
    if isinstance(opts, list):
        new_opts = []
        for o in opts:
            if isinstance(o, dict) and isinstance(o.get('text'), str) and o['text']:
                v = prep('opt' + o.get('id', ''), o['text'])
                nv = clean_text(v)
                if nv != o['text']:
                    o = {**o, 'text': nv}
                    changed += 1
            new_opts.append(o)
        out['options'] = new_opts
    table = out.get('tableJson')
    if isinstance(table, dict):
        nt = dict(table)
        for key in ('caption', 'columns', 'headers', 'rows'):
            v = nt.get(key)
            if isinstance(v, str):
                nt[key] = clean_text(v)
            elif isinstance(v, list):
                nt[key] = [
                    clean_text(x) if isinstance(x, str) else
                    [clean_text(c) if isinstance(c, str) else c for c in x] if isinstance(x, list) else x
                    for x in v
                ]
        if nt != table:
            out['tableJson'] = nt
            changed += 1
    return out, changed


def main() -> int:
    files = sorted(CURATED.glob('ssqb-*.json'))
    if not files:
        print(f'fix-wordmath: no curated records under {CURATED}')
        return 0
    changed_records = 0
    changed_fields = 0
    leftover: list[tuple[str, str, list[str]]] = []
    for f in files:
        rec = json.loads(f.read_text())
        # content-loss records: mark returned so they leave the simulator pools
        sid = rec.get('sourceId', f.stem)
        if sid in RETURNED and rec.get('review', {}).get('status') != 'returned':
            rec['review'] = {
                'status': 'returned',
                'reasons': ['other'],
                'note': RETURNED[sid],
                'at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            }
            f.write_text(json.dumps(rec, indent=2) + '\n')
            changed_records += 1
            continue
        out, n = clean_record(rec)
        if n:
            f.write_text(json.dumps(out, indent=2) + '\n')
            changed_records += 1
            changed_fields += n
        # residual scan on the cleaned text (report only)
        for field in TEXT_FIELDS + ('A', 'B', 'C', 'D'):
            if field in TEXT_FIELDS:
                v = out.get(field)
            else:
                v = next((o.get('text') for o in out.get('options', []) if o.get('id') == field), None)
            if not isinstance(v, str):
                continue
            for m in MATH_SEG_RE.finditer(v):
                r = residuals(m.group(1))
                if r:
                    leftover.append((out.get('sourceId', f.stem), m.group(1).strip()[:80], r))
    print(f'fix-wordmath: {len(files)} record(s) scanned, {changed_records} rewritten ({changed_fields} field(s))')
    if leftover:
        print(f'fix-wordmath: {len(leftover)} math segment(s) still carry verbal markers (manual review):')
        for sid, seg, r in leftover:
            print(f'  {sid}: {r} in {seg!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

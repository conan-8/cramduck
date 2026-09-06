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
import html
import sys
from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / 'lib'))

from wordmath import clean_text, residuals, MATH_SEG_RE  # noqa: E402

CURATED = ROOT / 'research' / 'sat' / 'curated'
CACHE = ROOT / 'research' / 'sat' / 'curate' / 'api-cache'

# apply-api-content.py owns the HTML->markup converter; import it by path
# (its filename has dashes).
_spec = spec_from_file_location('apply_api_content', ROOT / 'scripts' / 'apply-api-content.py')
_api = module_from_spec(_spec)
_spec.loader.exec_module(_api)


def _rebuild_fields(rec: dict) -> int:
    """Rebuilt truncated fields from the api-cache (see REBUILD_FROM_CACHE).
    Returns the number of fields replaced."""
    fields = REBUILD_FROM_CACHE.get(rec.get('sourceId', ''))
    if not fields:
        return 0
    cache_path = CACHE / f"{rec['sourceId']}.json"
    if not cache_path.exists():
        print(f"fix-wordmath: {rec['sourceId']} marked for rebuild but no api-cache — skipped")
        return 0
    payload = json.loads(cache_path.read_text()).get('payload') or {}
    is_old = 'item_id' in payload
    n = 0

    def conv(html_src: str) -> str:
        # old-format payloads are double-encoded ("&lt;/span&gt;") — unescape
        # first so the parser sees real tags; clean_text keeps re-runs
        # idempotent (the stored value is already cleaned)
        return clean_text(_api.convert_html(html.unescape(html_src), rec['sourceId'])['text'] or '')

    for field in fields:
        if field == 'prompt':
            raw = payload.get('stem') if not is_old else payload.get('prompt')
            nv = conv(raw or '')
            if nv and nv != rec.get('prompt'):
                rec['prompt'] = nv
                n += 1
        elif field == 'rationale':
            raw = payload.get('rationale') if not is_old else (payload.get('answer') or {}).get('rationale')
            nv = conv(raw or '')
            if nv and nv != rec.get('rationale'):
                rec['rationale'] = nv
                n += 1
        elif field == 'info':
            raw = payload.get('stimulus') if not is_old else payload.get('body')
            nv = conv(raw or '')
            if nv and nv != rec.get('info'):
                rec['info'] = nv
                n += 1
        elif field == 'options':
            new_opts = []
            if not is_old:
                for i, opt in enumerate((payload.get('answerOptions') or [])[:4]):
                    t = conv(opt.get('content') or '')
                    new_opts.append({'id': chr(65 + i), 'text': t or '[figure]'})
            else:
                choices = (payload.get('answer') or {}).get('choices') or {}
                for i, letter in enumerate('abcd'):
                    ch = choices.get(letter)
                    if ch:
                        new_opts.append({'id': chr(65 + i), 'text': conv(ch.get('body') or '')})
            if len(new_opts) == 4 and new_opts != rec.get('options'):
                rec['options'] = new_opts
                n += 1
        elif field.startswith('opt') and not is_old:
            idx = ord(field[3]) - 65
            opts = payload.get('answerOptions') or []
            if idx < len(opts):
                nv = conv(opts[idx].get('content') or '')
                if nv and nv != rec['options'][idx].get('text'):
                    rec['options'][idx]['text'] = nv
                    n += 1
    return n

TEXT_FIELDS = ('info', 'prompt', 'rationale', 'gridAnswer')

# Hand-verified repairs for damage no rule can safely reconstruct. Keyed by
# (sourceId, field) — 'optA'..'optD' address options. Each (old, new) pair is
# applied verbatim before the generic cleanup; pairs are applied only when
# `old` is present AND `new` is not, so re-runs never compound.
OVERRIDES: dict[tuple[str, str], list[tuple[str, str]]] = {
    ('ssqb-e117d3b8', 'rationale'): [
        (r'By rewriting \((a + c)^{4}\) as (\((a + c)^{2}\))\(^{2}, it is',
         r'By rewriting \((a + c)^{4}\) as \(( ( a + c )^{2} )^{2}\), it is'),
    ],
    ('ssqb-fc3dfa26', 'rationale'): [
        (r'by \(^{\(\frac{x - 3}{x - 3}\)} yields',
         r'by \(\frac{x - 3}{x - 3}\) yields'),
    ],
    ('ssqb-d41cf4d3', 'rationale'): [
        (r'it follows that \(a Choice A is incorrect.',
         r'it follows that \(a<b\). Choice A is incorrect.'),
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
    # 7392dfc1: the divisors were dropped from every "dividing by …" sentence;
    # each is recoverable from the resulting equation (4x+6=12 ÷ n).
    ('ssqb-7392dfc1', 'rationale'): [
        (r'by \(\) yields \(\frac{4x + 6}{2 = \frac{12}{2}}\)',
         r'by \(2\) yields \(\frac{4x + 6}{2} = \frac{12}{2}\)'),
        (r'by \(\) gives \(2x + 3 = 6\)',
         r'by \(2\) gives \(2x + 3 = 6\)'),
        (r'by \(\) gives \(x + \frac{3}{2} = 3\)',
         r'by \(4\) gives \(x + \frac{3}{2} = 3\)'),
        (r'by \(\) gives \(\frac{4}{3} x + 2 = 4\)',
         r'by \(3\) gives \(\frac{4}{3} x + 2 = 4\)'),
    ],
    # a1696f3e: the function name's math span was empty in the harvest.
    ('ssqb-a1696f3e', 'prompt'): [
        (r'The function \(\) is defined as \(g x = 5x + a\)',
         r'The function \(g\) is defined as \(g\left( x \right) = 5x + a\)'),
        (r'If \(g 4 = 31\)',
         r'If \(g\left( 4 \right) = 31\)'),
    ],
}

# Fields truncated by the harvest's HTML conversion (raw "<" in LaTeX chunks
# swallowed text) are rebuilt from the untouched api-cache via
# apply-api-content's convert_html. 'options' rebuilds all four choices.
REBUILD_FROM_CACHE: dict[str, list[str]] = {
    'ssqb-053e5e9f': ['prompt', 'rationale'],
    'ssqb-94f7c9e2': ['prompt', 'rationale'],
    'ssqb-72ae8a87': ['prompt'],
    'ssqb-d84a514a': ['prompt'],
    'ssqb-db88a933': ['prompt'],
    'ssqb-190be2fc': ['rationale'],
    'ssqb-46308566': ['rationale'],
    'ssqb-6aefc52b': ['rationale'],
    'ssqb-0ef4a7b6': ['rationale', 'options'],
    'ssqb-781c2f6e': ['prompt', 'rationale'],
    'ssqb-d41cf4d3': ['optD'],
    'ssqb-5bf5136d': ['optC'],
    'ssqb-064c8999': ['info'],
    'ssqb-6d69ab93': ['options'],
    'ssqb-8af926b1': ['info'],
    'ssqb-db88a933': ['rationale'],
    'ssqb-e11294f9': ['prompt', 'rationale'],
    'ssqb-e9349667': ['rationale'],
    'ssqb-f01ef454': ['options', 'rationale'],
}

# Records that stay out of the simulator pools (review.status='returned'):
#   c81b6c57 — the expression the question is about was lost at harvest and
#              is not in the api-cache either (old-format empty math span)
#   ecca0603 — answer choices are HTML tables; the options UI can't render them
RETURNED: dict[str, str] = {
    'ssqb-c81b6c57': 'expression containing p missing from prompt (harvest content loss, not in cache)',
    'ssqb-ecca0603': 'answer choices are table figures — unsupported by the options UI',
    'ssqb-1e1027a7': 'a t-value is missing from the choice-A rationale (empty math image in harvest)',
}


def clean_record(rec: dict) -> tuple[dict, int]:
    """Return (record with cleaned text fields, number of fields changed)."""
    changed = 0
    out = dict(rec)
    sid = out.get('sourceId', '')

    def prep(field: str, v: str) -> str:
        for old, new in OVERRIDES.get((sid, field), []):
            # guard: skip when the replacement is already applied — substring
            # overrides must never compound across runs
            if old in v and new not in v:
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
        sid = rec.get('sourceId', f.stem)
        review = rec.get('review') or {}
        if sid in RETURNED:
            # content-loss/unsupported records: keep them out of the pools
            if review.get('status') != 'returned' or review.get('note') != RETURNED[sid]:
                rec['review'] = {
                    'status': 'returned',
                    'reasons': ['other'],
                    'note': RETURNED[sid],
                    'at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                }
                f.write_text(json.dumps(rec, indent=2) + '\n')
                changed_records += 1
            continue
        if review.get('status') == 'returned' and review.get('note') and (
                'harvest content loss' in review['note'] or 'garbled at harvest' in review['note']):
            # recovered by a rebuild from the api-cache — restore approval
            rec['review'] = {'status': 'approved', 'at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
            review = rec['review']
            review_changed = True
        else:
            review_changed = False
        n_rebuilt = _rebuild_fields(rec)
        out, n = clean_record(rec)
        n += n_rebuilt
        if n or review_changed:
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

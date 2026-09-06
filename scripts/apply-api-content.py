#!/usr/bin/env python3
"""
apply-api-content.py — rebuild ALL curated records straight from the cached
College Board educator API payloads (curate/api-cache/), replacing the Excel
import as the source of truth.

Conversions:
  - HTML prose   -> author markup (\\( \\) LaTeX, [[ ]] underline, **bold**,
                    *italic*, blank line = paragraph)
  - <math> MathML-> LaTeX (structured recursive translator)
  - old-format base64 math-img -> LaTeX via its spoken alt text
  - <figure class="table"> -> tableJson (native simulator table)
  - inline <svg> -> assets/figures/ssqb-<id>.svg diagram
  - answerOptions/answer.choices -> options A-D; correct from correct_answer
  - spr -> gridAnswer

Review blocks on existing records are preserved. Anything the converters
cannot handle faithfully is written anyway but listed in the console report
(missing correct answer, residual speech tokens in LaTeX) so it can be fixed
or sent back during manual review.

Afterwards: npm run sync:assets && npm run seed && npm run build:app
"""

import base64
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SAT = ROOT / 'research' / 'sat'
CACHE = SAT / 'curate' / 'api-cache'
FIGURES = SAT / 'assets' / 'figures'
CURATED = SAT / 'curated'
BANK = SAT / 'question-bank'
LOOKUP = SAT / 'curate' / 'lookup.json'

DIFF_MAP = {'E': ('easy', 2), 'M': ('medium', 3), 'H': ('hard', 4)}
SKILL_SLUGS = {
    'central ideas and details': 'central-ideas-details',
    'command of evidence textual': 'command-evidence-textual',
    'command of evidence quantitative': 'command-evidence-quantitative',
    'inferences': 'inferences',
    'words in context': 'words-in-context',
    'text structure and purpose': 'text-structure-purpose',
    'cross-text connections': 'cross-text-connections',
    'boundaries': 'boundaries',
    'form structure and sense': 'form-structure-sense',
    'transitions': 'transitions',
    'rhetorical synthesis': 'rhetorical-synthesis',
    'linear equations in one variable': 'linear-equations-one-var',
    'linear equations in two variables': 'linear-equations-two-vars',
    'linear functions': 'linear-functions',
    'linear inequalities in one or two variables': 'linear-inequalities',
    'systems of two linear equations in two variables': 'systems-linear-equations',
    'equivalent expressions': 'equivalent-expressions',
    'nonlinear equations in one variable and systems of equations in two variables': 'nonlinear-equations-systems',
    'nonlinear functions': 'nonlinear-functions',
    'ratios rates proportional relationships and units': 'ratios-rates-proportions',
    'percentages': 'percentages',
    'one variable data distributions and measures of center and spread': 'one-variable-data',
    'two variable data models and scatterplots': 'two-variable-data',
    'probability and conditional probability': 'probability-conditional',
    'inference from sample statistics and margin of error': 'sample-statistics-margin-error',
    'evaluating statistical claims observational studies and experiments': 'evaluating-claims',
    'area and volume': 'area-volume',
    'lines angles and triangles': 'lines-angles-triangles',
    'right triangles and trigonometry': 'right-triangles-trig',
    'circles': 'circles',
}


def load_lookup() -> set[str]:
    """Live (Bluebook) item uuids, cached."""
    if LOOKUP.exists():
        d = json.loads(LOOKUP.read_text())
    else:
        req = urllib.request.Request(
            'https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/lookup',
            headers={'origin': 'https://satsuiteeducatorquestionbank.collegeboard.org'})
        d = json.loads(urllib.request.urlopen(req, timeout=30).read())
        LOOKUP.write_text(json.dumps(d))
    return set(d.get('readingLiveItems', [])) | set(d.get('mathLiveItems', []))


def iso(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat().replace('+00:00', 'Z')
    except (TypeError, ValueError):
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

# --- MathML -> LaTeX ----------------------------------------------------------

OP_MAP = {'−': '-', '–': '-', '×': '\\times', '÷': '\\div', '≤': '\\leq', '≥': '\\geq',
          '≠': '\\neq', '±': '\\pm', '·': '\\cdot', '∞': '\\infty', '→': '\\to',
          '⟶': '\\to', '↔': '\\leftrightarrow', '≈': '\\approx', '≅': '\\cong',
          '∼': '\\sim', '°': '^\\circ', '∠': '\\angle', 'π': '\\pi', 'θ': '\\theta',
          'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'Δ': '\\Delta', '∪': '\\cup',
          '∩': '\\cap', '∈': '\\in', '⊥': '\\perp', '∥': '\\parallel', 'ℓ': '\\ell',
          '…': '\\ldots', '‹': '<', '›': '>', '≤': '\\le', '≥': '\\ge'}

OVER_MAP = {'¯': '\\overline', '→': '\\vec', '⇀': '\\vec', '^': '\\hat', '˙': '\\dot',
            '¨': '\\ddot', '~': '\\tilde', '←': '\\overleftarrow'}


def mathml_to_latex(node) -> str:
    tag = node.tag.split('}')[-1]
    kids = list(node)
    inner = ''.join(mathml_to_latex(k) for k in kids)
    text = (node.text or '') + ''.join((k.tail or '') for k in kids)
    if tag in ('math', 'mrow', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'mtd'):
        return inner + text
    if tag == 'mn':
        return node.text or ''
    if tag == 'mi':
        t = (node.text or '').strip()
        if len(t) > 1 and t not in ('sin', 'cos', 'tan', 'log', 'ln', 'lim', 'min', 'max'):
            return f'\\text{{{t}}}'
        return t
    if tag == 'mtext':
        return f'\\text{{{node.text or ""}}}'
    if tag == 'mo':
        t = (node.text or '').strip()
        return OP_MAP.get(t, t)
    if tag == 'mspace':
        return '\\,'
    if tag == 'mfrac':
        a = mathml_to_latex(kids[0]) if len(kids) > 0 else ''
        b = mathml_to_latex(kids[1]) if len(kids) > 1 else ''
        return f'\\frac{{{a}}}{{{b}}}'
    if tag == 'msup':
        return f'{brace(mathml_to_latex(kids[0]))}^{{{mathml_to_latex(kids[1])}}}' if len(kids) > 1 else inner
    if tag == 'msub':
        return f'{brace(mathml_to_latex(kids[0]))}_{{{mathml_to_latex(kids[1])}}}' if len(kids) > 1 else inner
    if tag in ('msubsup',):
        return f'{brace(mathml_to_latex(kids[0]))}_{{{mathml_to_latex(kids[1])}}}^{{{mathml_to_latex(kids[2])}}}' if len(kids) > 2 else inner
    if tag == 'msqrt':
        return f'\\sqrt{{{inner}}}'
    if tag == 'mroot':
        return f'\\sqrt[{mathml_to_latex(kids[1])}]{{{mathml_to_latex(kids[0])}}}' if len(kids) > 1 else f'\\sqrt{{{inner}}}'
    if tag == 'mfenced':
        open_d = node.get('open', '(')
        close_d = node.get('close', ')')
        sep = node.get('separators', ',')
        parts = [mathml_to_latex(k) for k in kids]
        body = (sep if sep else ',').join(parts) if len(parts) > 1 else (parts[0] if parts else inner)
        return f'\\left{open_d} {body} \\right{close_d}'
    if tag == 'mover':
        base = mathml_to_latex(kids[0]) if kids else ''
        over = (kids[1].text or '').strip() if len(kids) > 1 else ''
        fn = OVER_MAP.get(over)
        if fn == '\\overline':
            return f'\\overline{{{base}}}'
        if fn:
            return f'{fn}{{{base}}}'
        return f'{base}^{{{over}}}'
    if tag == 'munder':
        base = mathml_to_latex(kids[0]) if kids else ''
        under = (kids[1].text or '').strip() if len(kids) > 1 else ''
        if under == '−':
            return f'\\underline{{{base}}}'
        return f'{base}_{{{under}}}'
    if tag == 'mtable':
        rows = [k for k in kids if k.tag.split('}')[-1] == 'mtr']
        out = []
        for r in rows:
            cells = [mathml_to_latex(c) for c in r if c.tag.split('}')[-1] == 'mtd']
            out.append(' & '.join(cells))
        return '\\begin{array} ' + ' \\\\ '.join(out) + ' \\end{array}'
    return inner + text


def brace(s: str) -> str:
    return s if len(s) == 1 or (s.startswith('\\') and '{' not in s[:8]) else f'{{{s}}}'


def convert_mathml_chunks(text: str) -> str:
    def rep(m):
        chunk = m.group(0)
        try:
            root = ET.fromstring(chunk if '<math' in chunk else f'<math>{chunk}</math>')
            return '\\(' + mathml_to_latex(root) + '\\)'
        except ET.ParseError:
            alt = re.search(r'alttext="([^"]*)"', chunk)
            return '\\(' + speech_to_latex(alt.group(1)) + '\\)' if alt else chunk
    return re.sub(r'<math\b.*?</math>', rep, text, flags=re.S)


# --- spoken alt -> LaTeX ------------------------------------------------------

SPEECH_OPS = {'plus': '+', 'minus': '-', 'times': '\\times', 'divided by': '\\div',
              'equals': '=', 'is equal to': '=', 'less than': '<', 'greater than': '>',
              'less than or equal to': '\\leq', 'greater than or equal to': '\\geq',
              'plus or minus': '\\pm', 'to the power of': '^'}


def speech_to_latex(alt: str) -> str:
    s = html.unescape(alt).strip()
    # fraction phrasings first
    s = re.sub(r'(?i)StartFraction\s+(.+?)\s+Over\s+(.+?)\s+EndFraction', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)the fraction,\s*(.+?),\s*over\s*(.+?),\s*end fraction', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)the fraction\s+(.+?)\s+over\s+(.+?)(?:\s+end fraction|$)', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)fraction\s+(.+?)\s+over\s+(.+?)(?:\s+end fraction|$)', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)numerator\s+(.+?),?\s+denominator\s+(.+?)(?:,?\s*end fraction|$)', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)fraction with numerator\s+(.+?)\s+and denominator\s+(.+?)(?=\s*end fraction|[,.=]|$)', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)numerator\s+(.+?)\s+and denominator\s+(.+?)(?=\s*end fraction|[,.=]|$)', r'\\frac{\1}{\2}', s)
    s = re.sub(r'(?i)(\d+)\s*([a-z]+) over (\d+)\s*([a-z]+)', r'\\frac{\1 \\text{ \2}}{\3 \\text{ \4}}', s)
    s = re.sub(r'(?i)\b(\d+(?:\.\d+)?) over (\d+(?:\.\d+)?)\b', r'\\frac{\1}{\2}', s)
    s = s.replace('left parenthesis', '(').replace('right parenthesis', ')')
    s = re.sub(r'(?i)([a-zA-Z]) sub ([a-zA-Z0-9]+)', r'\1_{\2}', s)
    s = re.sub(r'(?i)\bdegree\b', lambda m: '^\\circ', s)
    s = re.sub(r'(?i)the cube root of\s+(.+?)(?=,|$)', r'\\sqrt[3]{\1}', s)
    s = re.sub(r'(?i)the square root of\s+(.+?)(?=,|$)', r'\\sqrt{\1}', s)
    s = re.sub(r'(?i)StartRoot\s+(.+?)\s+EndRoot', r'\\sqrt{\1}', s)
    s = s.replace('open parenthesis', '(').replace('close parenthesis', ')')
    s = s.replace('OpenParenthesis', '(').replace('CloseParenthesis', ')')
    s = re.sub(r'(?i)\b(\w+)\s+squared\b', r'\1^{2}', s)
    s = re.sub(r'(?i)\b(\w+)\s+cubed\b', r'\1^{3}', s)
    for phrase, op in sorted(SPEECH_OPS.items(), key=lambda kv: -len(kv[0])):
        s = re.sub(re.escape(phrase), lambda m, op=op: op, s, flags=re.I)
    s = re.sub(r'(?i)\)\s+squared\b', ')^{2}', s)
    s = re.sub(r'(?i)\)\s+cubed\b', ')^{3}', s)
    s = re.sub(r'(?i)\bpoint\b', '.', s)
    s = re.sub(r'(?i)\bnegative\b', '-', s)
    s = re.sub(r'(?i)\bdegrees\b', lambda m: '^\\circ', s)
    s = re.sub(r'(?i)\bcomma\b', ',', s)
    s = s.replace(',', ' ')
    FRACTIONS = {'one half': '\\frac{1}{2}', 'a half': '\\frac{1}{2}', 'one third': '\\frac{1}{3}',
                 'two thirds': '\\frac{2}{3}', 'one quarter': '\\frac{1}{4}', 'a quarter': '\\frac{1}{4}',
                 'three quarters': '\\frac{3}{4}', 'three fourths': '\\frac{3}{4}'}
    for phrase, sym in FRACTIONS.items():
        s = re.sub(rf'(?i)\b{phrase}\b', lambda m, sym=sym: sym, s)
    s = re.sub(r'(?i)\band\b', ',', s)
    GREEK = {'pi': '\\pi', 'theta': '\\theta', 'alpha': '\\alpha', 'beta': '\\beta',
             'gamma': '\\gamma', 'delta': '\\delta', 'sigma': '\\sigma', 'phi': '\\phi',
             'omega': '\\omega', 'mu': '\\mu', 'lambda': '\\lambda', 'tau': '\\tau'}
    for word, sym in GREEK.items():
        s = re.sub(rf'(?i)\b{word}\b', lambda m, sym=sym: sym, s)
    s = re.sub(r'(?i)\b(the|of|which|end|is)\b', ' ', s)
    s = re.sub(r'(\d)\s*\.\s*(\d)', r'\1.\2', s)
    s = re.sub(r'(\d) (?=\d)', r'\1', s)
    s = re.sub(r'(\d) ([a-zA-Z])', r'\1\2', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


RESIDUAL_RX = re.compile(r'(?<!\\)\b(plus|minus|times|equals|open|close|parenthesis|squared|fraction|numerator|denominator|root|negative|point|degrees|StartFraction|EndFraction|Over)\b', re.I)


# --- HTML -> markup ------------------------------------------------------------

class BlockParser(HTMLParser):
    """Convert item HTML to author markup; figures/tables/svgs are extracted."""

    def __init__(self, qid: str | None = None):
        # convert_charrefs=False: captured SVG/table markup must stay
        # byte-faithful (&lt; inside a <text> label must NOT become a real <).
        super().__init__(convert_charrefs=False)
        self.qid = qid
        self.out: list[str] = []
        self.table_html: list[str] = []
        self.svg: str | None = None
        self._skip = 0
        self._skip_stack: list[str] = []
        self._img_n = 0
        self._inline_stack: list[str] = []
        self._capture: str | None = None  # 'table' | 'svg'
        self._buf: list[str] = []

    def _emit(self, s: str):
        if self._capture:
            self._buf.append(s)
        elif self._skip == 0:
            self.out.append(s)

    def handle_starttag(self, tag, attrs):
        ad = dict(attrs)
        cls = ad.get('class', '')
        if tag == 'figure':
            return  # contents (svg/table) were pre-extracted by regex
        if self._capture:
            self._buf.append(self.get_starttag_text() or '')
            return
        if 'sr-only' in cls:
            self._skip += 1
            self._skip_stack.append(tag)
            return
        if tag == 'p':
            self._emit('\n\n')
        elif tag == 'br':
            self._emit(' ')
        elif tag == 'li':
            self._emit('\n• ')
        elif tag == 'u':
            self._emit('[[')
            self._inline_stack.append(']]')
        elif tag in ('strong', 'b'):
            self._emit('**')
            self._inline_stack.append('**')
        elif tag in ('em', 'i') or 'italic' in cls:
            self._emit('*')
            self._inline_stack.append('*')
        elif tag == 'sup':
            self._emit('SUPER{')
            self._inline_stack.append('}')
        elif tag == 'sub':
            self._emit('SUB{')
            self._inline_stack.append('}')
        elif tag == 'span' and ad.get('aria-hidden') == 'true':
            pass  # visible underscores etc. flow through as text
        elif tag == 'img' and 'math-img' in cls:
            alt = ad.get('alt', '')
            self._emit('\\(' + speech_to_latex(alt) + '\\)' if alt else '[MATH?]')
        elif tag == 'img':
            src = ad.get('src', '')
            m = re.match(r'data:image/(\w+);base64,(.+)', src, re.S)
            if m and self.qid:
                self._img_n += 1
                ext = 'png' if m.group(1) == 'png' else 'jpg'
                dest = FIGURES.parent / 'choiceimg' / f'ssqb-{self.qid}-{self._img_n}.{ext}'
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(base64.b64decode(m.group(2)))
                self._emit(f'{{{{img:assets/choiceimg/ssqb-{self.qid}-{self._img_n}.{ext}}}}}')
            else:
                self._emit('[IMG?]')
        elif tag == 'table':
            self._capture, self._buf = 'table', [self.get_starttag_text()]
        elif tag == 'svg':
            self._capture, self._buf = 'svg', [self.get_starttag_text()]

    def handle_startendtag(self, tag, attrs):
        # self-closing tag (SVG <rect/> etc.): capture raw text once, no fake closer
        if self._capture:
            self._buf.append(self.get_starttag_text() or '')
            return
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self._capture == 'table' and tag == 'table':
            self._buf.append('</table>')
            self.table_html.append(''.join(self._buf))
            self._capture, self._buf = None, []
            return
        if self._capture == 'svg' and tag == 'svg':
            self._buf.append('</svg>')
            self.svg = (self.svg or '') + ''.join(self._buf)
            self._capture, self._buf = None, []
            return
        if self._capture:
            self._buf.append(f'</{tag}>')
            return
        if self._skip_stack and tag == self._skip_stack[-1]:
            self._skip_stack.pop()
            self._skip -= 1
        elif self._inline_stack and tag in ('u', 'strong', 'b', 'em', 'i', 'sup', 'sub', 'span'):
            self._emit(self._inline_stack.pop())
        elif tag == 'p':
            self._emit('\n\n')

    def handle_entityref(self, name):
        raw = f'&{name};'
        if self._capture:
            self._buf.append(raw)
        elif self._skip == 0:
            self.out.append(html.unescape(raw).replace('\xa0', ' '))

    def handle_charref(self, name):
        raw = f'&#{name};'
        if self._capture:
            self._buf.append(raw)
        elif self._skip == 0:
            self.out.append(html.unescape(raw).replace('\xa0', ' '))

    def handle_data(self, data):
        if self._capture:
            self._buf.append(data)
        elif self._skip == 0:
            self.out.append(data.replace('\xa0', ' '))

    def text(self) -> str:
        t = ''.join(self.out)
        t = t.replace('SUPER{', '\\(^{').replace('SUB{', '\\(_{')
        t = re.sub(r'SUPER\{([^}]*)\}', '\\\\(^{\\1}\\\\)', t)
        return cleanup(t)


def cleanup(t: str) -> str:
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    # MathML source carries newlines/tabs between elements — collapse all
    # whitespace inside LaTeX chunks so RichText's split regex matches.
    t = re.sub(r'\\\((.+?)\\\)', lambda m: '\\(' + re.sub(r'\s+', ' ', m.group(1)).strip() + '\\)', t, flags=re.S)
    return t.strip()


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.caption = None
        self.headers: list[list[str]] = []
        self.rows: list[list[str]] = []
        self._mode = None
        self._cell = ''
        self._row: list[str] = []
        self._row_is_header = True

    def handle_starttag(self, tag, attrs):
        if tag == 'caption':
            self._mode = 'caption'
        elif tag == 'tr':
            self._row, self._row_is_header = [], True
        elif tag == 'th':
            self._mode, self._cell = 'th', ''
        elif tag == 'td':
            self._mode, self._cell = 'td', ''
            self._row_is_header = False
        elif tag == 'br':
            self._cell += ' '

    def handle_endtag(self, tag):
        if tag == 'caption':
            self._mode = None
        elif tag in ('th', 'td'):
            self._row.append(re.sub(r'\s+', ' ', self._cell).strip())
            self._mode = None
        elif tag == 'tr':
            if self._row:
                (self.headers if self._row_is_header else self.rows).append(self._row)

    def handle_data(self, data):
        if self._mode == 'caption':
            self.caption = (self.caption or '') + data
        elif self._mode in ('th', 'td'):
            self._cell += data.replace('\xa0', ' ')


MATH_IMG_RX = re.compile(r'<img\b[^>]*>', re.I)


def math_imgs_to_latex(html: str) -> str:
    """Old-format items carry math as base64 <img class="math-img"> with a
    spoken alt — convert those everywhere (including inside table cells,
    which the text parser never sees)."""

    def rep(m: re.Match) -> str:
        tag = m.group(0)
        if 'math-img' not in tag:
            return tag
        am = re.search(r'alt="([^"]*)"', tag)
        return '\\(' + speech_to_latex(am.group(1)) + '\\)' if am else '[MATH?]'

    return MATH_IMG_RX.sub(rep, html)


def convert_html(raw: str, qid: str | None = None) -> dict:
    """Returns {text, table, svg} for one HTML blob. Figures and tables are
    extracted by regex FIRST so they stay byte-faithful (HTMLParser lowercases
    end-tag case and converts entities, which corrupts SVG)."""
    s = math_imgs_to_latex(convert_mathml_chunks(raw))
    svgs = re.findall(r'<svg\b.*?</svg>', s, re.S | re.I)
    tables_html = re.findall(r'<table\b.*?</table>', s, re.S | re.I)
    s = re.sub(r'<svg\b.*?</svg>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'<table\b.*?</table>', ' ', s, flags=re.S | re.I)
    # LaTeX chunks carry raw < and > (MathML &lt;/&#60; become real chars in
    # mathml_to_latex output) — an HTML parser would read "<RS\)" as a tag
    # and swallow everything up to the next ">". Escape them inside math
    # spans before BlockParser; handle_entityref unescapes them back to text.
    s = re.sub(
        r'\\\((.+?)\\\)',
        lambda m: '\\(' + m.group(1).replace('<', '&lt;').replace('>', '&gt;') + '\\)',
        s, flags=re.S)
    p = BlockParser(qid)
    p.feed(s)
    text = p.text()
    table = None
    if tables_html:
        tp = TableParser()
        tp.feed(tables_html[0])
        table = {
            'caption': re.sub(r'\s+', ' ', tp.caption or '').strip() or None,
            'columns': tp.headers[0] if tp.headers else [],
            'rows': tp.headers[1:] + tp.rows,
        }
    svg = ''.join(svgs) or None
    return {'text': text or None, 'table': table, 'svg': svg}


# --- record assembly -----------------------------------------------------------

def letters_correct(payload: dict, options_count: int):
    ca = payload.get('correct_answer')
    if isinstance(ca, list) and ca and isinstance(ca[0], str) and ca[0] in 'ABCD':
        return ca[0], None
    return (ca if isinstance(ca, str) and ca in 'ABCD' else None), ca


def main() -> int:
    FIGURES.mkdir(parents=True, exist_ok=True)
    live = load_lookup()
    bank_cache: dict[str, dict | None] = {}

    def bank(qid: str) -> dict | None:
        if qid not in bank_cache:
            p = BANK / f'ssqb-{qid}.json'
            bank_cache[qid] = json.loads(p.read_text()) if p.exists() else None
        return bank_cache[qid]

    problems: list[str] = []
    written = 0
    for f in sorted(CACHE.glob('ssqb-*.json')):
        cache = json.loads(f.read_text())
        qid = cache['questionId']
        meta = cache['list']
        payload = cache['payload']
        rec_path = CURATED / f'ssqb-{qid}.json'
        old = json.loads(rec_path.read_text()) if rec_path.exists() else {}

        is_old = 'item_id' in payload
        pcc = meta.get('primary_class_cd') or ''
        section = (payload.get('section') or '').lower()
        if section.startswith('read'):
            section = 'reading-writing'
        elif section.startswith('math'):
            section = 'math'
        else:
            section = 'reading-writing' if pcc in ('INI', 'CAS', 'EOI', 'SEC') else 'math'
        qtype_raw = payload.get('type') or ('spr' if is_old and (payload.get('answer') or {}).get('style') == 'SPR' else 'mcq')
        qtype = 'grid_in' if qtype_raw == 'spr' else 'mcq'

        stim_raw = payload.get('stimulus') if not is_old else payload.get('body')
        stem_raw = payload.get('stem') if not is_old else payload.get('prompt')
        stim = convert_html(stim_raw or '', qid)
        stem = convert_html(stem_raw or '', qid)

        diagram = None
        svg = stim['svg'] or stem['svg']
        if svg:
            # XML (and browsers via <img>) only know lt/gt/amp/quot/apos/#num;
            # turn HTML named entities (&times; &ndash; ...) into unicode.
            svg = re.sub(r'&(?!lt;|gt;|amp;|quot;|apos;|#)[a-zA-Z0-9]+;', lambda m: html.unescape(m.group(0)), svg)
            (FIGURES / f'ssqb-{qid}.svg').write_text(svg)
            diagram = f'assets/figures/ssqb-{qid}.svg'
        table = stim['table'] or stem['table']
        info = stim['text'] if stim['text'] else None
        prompt = stem['text'] or ''

        options: list[dict] = []
        correct = None
        grid = None
        if qtype == 'mcq' and not is_old:
            for i, opt in enumerate(payload.get('answerOptions') or []):
                c = convert_html(opt.get('content') or '', qid)
                options.append({'id': chr(65 + i), 'text': c['text'] or '[figure]'})
            correct, raw_ca = letters_correct(payload, len(options))
            if correct is None:
                keys = payload.get('keys') or []
                ids = [o.get('id') for o in (payload.get('answerOptions') or [])]
                if keys and keys[0] in ids:
                    correct = chr(65 + ids.index(keys[0]))
        elif qtype == 'mcq' and is_old:
            ans = payload.get('answer') or {}
            choices = ans.get('choices') or {}
            for letter in 'abcd':
                ch = choices.get(letter)
                if not ch:
                    continue
                c = convert_html(ch.get('body') or '', qid)
                options.append({'id': letter.upper(), 'text': c['text'] or '[figure]'})
            correct = (ans.get('correct') or ans.get('correctResponse') or '').upper() or None
            if not correct:
                m = re.search(r'Choice ([A-D]) is (?:the )?correct', ans.get('rationale') or '')
                correct = m.group(1) if m else None
            if not correct:
                m = re.search(r'[Tt]he correct answer is\s+([A-D])\b', ans.get('rationale') or '')
                correct = m.group(1) if m else None
        else:  # grid_in
            ca = payload.get('correct_answer') or []
            if is_old:
                m = re.search(r'correct answer is (?:either )?\s*(-?\d+(?:[./]\d+)*)', (payload.get('answer') or {}).get('rationale') or '', re.I)
                grid = m.group(1).strip() if m else None
                correct = grid
            else:
                grid = ca[0] if ca else None
                correct = grid

        b0 = bank(qid)
        if qtype == 'grid_in' and not grid and b0 and b0.get('questionType') == 'grid_in':
            grid = b0.get('correctAnswer')
            correct = grid
        if not prompt and b0:
            prompt = b0.get('stem') or ''
        if not info and b0 and (b0.get('stimulus') or {}).get('text'):
            info = b0['stimulus']['text']
        rationale_raw = payload.get('rationale') if not is_old else (payload.get('answer') or {}).get('rationale')
        rationale = convert_html(rationale_raw or '', qid)['text'] if rationale_raw else None
        if qtype == 'mcq' and correct not in ('A', 'B', 'C', 'D') and rationale:
            m = re.search(r'Choice ([A-D]) is (?:the )?(?:best answer|correct)', rationale)
            if m:
                correct = m.group(1)

        if qtype == 'mcq' and (len(options) != 4 or not correct):
            problems.append(f'{qid}: mcq options={len(options)} correct={correct}')
        if qtype == 'grid_in' and not grid:
            problems.append(f'{qid}: grid_in missing answer')
        if not prompt:
            problems.append(f'{qid}: empty prompt')
        # an option/pane that is ONLY a graph image gets the block-level variant
        def to_full(t: str | None) -> str | None:
            t2 = (t or '').strip()
            return t2.replace('{{img:', '{{imgfull:', 1) if re.fullmatch(r'\{\{img:[^}]+\}\}', t2) else t

        info = to_full(info)
        prompt = to_full(prompt)
        for o in options:
            o['text'] = to_full(o['text'])

        all_text = ' '.join([info or '', prompt, rationale or '', ''.join(o['text'] or '' for o in options)])
        if '[MATH?]' in all_text or '[IMG?]' in all_text:
            problems.append(f'{qid}: unconverted math/image placeholder')
        elif any(RESIDUAL_RX.search(m) for m in re.findall(r'\\\(.+?\\\)', all_text)):
            problems.append(f'{qid}: residual speech tokens inside LaTeX')

        b = bank(qid)
        diff = DIFF_MAP.get(meta.get('difficulty') or '', ('medium', 3))
        skill_key = re.sub(r'[^a-z ]', '', (meta.get('skill_desc') or '').lower()).strip()
        skill = (meta.get('skill_cd') or '') and SKILL_SLUGS.get(skill_key, skill_key.replace(' ', '-'))
        if skill in ('command-evidence', 'command-of-evidence'):
            skill = 'command-evidence-quantitative' if (diagram or table) else 'command-evidence-textual'
        origin = 'bluebook' if (meta.get('external_id') or meta.get('uId')) in live else 'question_bank'
        rec = {
            'sourceId': f'ssqb-{qid}',
            'origin': b['origin'] if b else origin,
            'section': section,
            'domain': b['domain'] if b else (meta.get('primary_class_cd_desc') or meta.get('domain') or ''),
            'skill': b['skill'] if b else (skill or ''),
            'difficultyOfficial': b['difficultyOfficial'] if b else diff[0],
            'difficultyInternal': b['difficultyInternal'] if b else diff[1],
            'questionType': qtype,
            'info': info,
            'prompt': prompt,
            'options': options,
            'gridAnswer': grid if qtype == 'grid_in' else None,
            'correctAnswer': correct or grid or '',
            'rationale': rationale,
            'diagram': diagram,
            'tableJson': table,
            'sourceUrl': 'https://satsuitequestionbank.collegeboard.org/',
            'harvestedAt': b['harvestedAt'] if b else iso(meta.get('updateDate')),
            'curatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'allowedUses': ['internal_eval'],
        }
        if old.get('review'):
            rec['review'] = old['review']
        rec_path.write_text(json.dumps(rec, indent=2) + '\n')
        written += 1

    print(f'curated records written: {written}')
    print(f'problems: {len(problems)}')
    for p in problems[:40]:
        print(' -', p)
    return 0


if __name__ == '__main__':
    sys.exit(main())

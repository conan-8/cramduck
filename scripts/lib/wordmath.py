"""Verbal-math -> LaTeX cleanup for College Board alttext transcriptions.

The SSQB accessibility text verbalizes math ("fourth root x squared root",
"2raised to x power", "fraction with numerator a , denominator b"). Curators
pasted that text into the curation workbook and it landed verbatim inside
\\(...\\) math segments, where KaTeX renders the words as mangled italics.

clean_math(seg) rewrites one math segment's word-math into real LaTeX.
clean_text(text) applies it to every \\(...\\) segment of a content string.
RESIDUAL_RE detects leftovers the rules missed (used for reporting).
"""

import re

# --- word banks ---------------------------------------------------------------

ORDINALS = {
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
    'eleventh': 11, 'twelfth': 12, 'thirteenth': 13, 'fourteenth': 14,
    'fifteenth': 15, 'sixteenth': 16, 'seventeenth': 17, 'eighteenth': 18,
    'nineteenth': 19, 'twentieth': 20,
    'twenty first': 21, 'twenty second': 22, 'twenty third': 23,
    'twenty fourth': 24, 'twenty fifth': 25, 'twenty sixth': 26,
    'twenty seventh': 27, 'twenty eighth': 28, 'twenty ninth': 29,
}
_PLURALS = {2: 'halves', 3: 'thirds', 4: 'fourths', 5: 'fifths',
            6: 'sixths', 7: 'sevenths', 8: 'eighths', 9: 'ninths',
            10: 'tenths', 12: 'twelfths'}
_SINGULARS = {2: 'half', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
              7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 12: 'twelfth'}
_DIGITS = {'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
           'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
           'eleven': 11, 'twelve': 12}
# spoken fraction phrases -> \frac{n}{d}
FRAC_WORDS = {}
for _nw, _n in _DIGITS.items():
    for _dw, _d in _DIGITS.items():
        if _d in _PLURALS:
            FRAC_WORDS[f'{_nw} {_PLURALS[_d]}'] = (_n, _d)
for _dw, _d in _DIGITS.items():
    if _d in _SINGULARS:
        _sg = _SINGULARS[_d]
        FRAC_WORDS[f'one {_sg}'] = (1, _d)
        FRAC_WORDS[f'a {_sg}'] = (1, _d)
        FRAC_WORDS[f'one-{_sg}'] = (1, _d)

UNITS = ('miles', 'mile', 'seconds', 'hours', 'hour', 'minutes', 'minute',
         'centimeters', 'centimeter', 'meters', 'meter', 'feet', 'inches',
         'gallons', 'gallon', 'ounces', 'ounce', 'liters', 'liter', 'litres',
         'litre', 'pounds', 'pound', 'kilograms', 'kilogram', 'grams', 'gram',
         'milligrams', 'milligram', 'kilometers', 'kilometer', 'yards', 'yard',
         'cups', 'cup', 'quarts', 'quart', 'pints', 'pint', 'tablespoons',
         'teaspoons', 'milliliters', 'milliliter', 'tons', 'ton', 'cubic',
         'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year')

# multi-word unit phrases first ("fluid ounces", "square feet", …)
UNIT_PHRASES = ('fluid ounces', 'fluid ounce', 'square feet', 'square foot',
                'square inches', 'square inch', 'square yards', 'square yard',
                'square meters', 'square meter', 'square miles', 'square mile',
                'cubic feet', 'cubic foot', 'cubic inches', 'cubic inch',
                'cubic meters', 'cubic meter', 'cubic centimeters',
                'cubic centimeter', 'cubic yards', 'pounds per square inch',
                'miles per hour', 'kilometers per hour', 'meters per second')

_TEXTSPAN_RX = re.compile(r'\\text\{[^{}]*\}')

# base of a power: parenthesized group (one level of nesting) or token cluster
_BASE = r'(\((?:[^()]|\([^()]*\))*\)|[\w.{}^\\]+(?:\s+[\w.{}^\\]+)*?)'
_ORDINAL_ALT = '|'.join(sorted(ORDINALS, key=len, reverse=True))


def _brace_y(y: str) -> str:
    y = y.strip()
    if y.startswith('(') and y.endswith(')'):
        return f'{{({y[1:-1].strip()})}}'
    return f'{{{y}}}'


# --- glued-command repair ------------------------------------------------------

# LaTeX commands that legitimately appear in the bank — never split these.
COMMANDS = frozenset('''
left right bigl bigr big Big bigg Bigg leq geq neq le ge cdot times div pm mp
pi theta alpha beta gamma delta sigma phi omega mu lambda tau rho kappa
epsilon zeta eta iota nu xi chi psi upsilon varphi vartheta varepsilon
approx infty sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh
log ln lg lim limits min max deg arg det gcd frac dfrac tfrac sqrt overline
underline hat bar vec dot ddot tilde prime circ bullet ast star dagger
ddagger hbar ell Re Im aleph wp top bot emptyset varnothing angle
measuredangle triangle equiv sim simeq cong propto prec succ preceq succeq
ll gg subset supset subseteq supseteq sqsubseteq sqsupseteq in ni cup cap
setminus backslash forall exists neg land lor vee wedge oplus ominus otimes
perp parallel nparallel mid nmid therefore because dots ldots cdots vdots
ddots text textbf textit textrm textsf texttt mathrm mathbf mathit mathsf
mathtt mathcal mathbb mathfrak overbrace underbrace overset underset
stackrel binom dbinom tbinom sum prod int iint iiint oint point partial
nabla surd coprod bigcup bigcap bigoplus bigotimes bigodot bigvee bigwedge
bigsqcup biguplus uplus sqcap sqcup wr diamond triangleleft triangleright
triangleq coloneq coloneqq eqqcolon defeq doteq doteqdot risingdotseq
fallingdotseq hspace vspace quad qquad displaystyle textstyle scriptstyle
scriptscriptstyle nonumber tag label ref eqref begin end bbox color
textcolor colorbox fcolorbox mathop mathrel mathbin mathord mathopen
mathclose mathinner operatorname boldsymbol pmb meta mod pmod bmod pod
'''.split())

GLUED_RX = re.compile(r'\\([a-zA-Z]+)')
_COMMANDS_BY_LENGTH = sorted(COMMANDS, key=len, reverse=True)


def _unglue(m: re.Match) -> str:
    word = m.group(1)
    if word in COMMANDS:
        return m.group(0)
    for cmd in _COMMANDS_BY_LENGTH:
        if word.startswith(cmd) and len(word) > len(cmd):
            return '\\' + cmd + ' ' + word[len(cmd):]
    return m.group(0)


def clean_math(seg: str) -> str:
    s = seg

    # 0. glued markers: "1.02raised", "2power", "3root", "1over", "2to x power"
    s = re.sub(r'(?i)([\w.})])\s*raised\b', r'\1 raised', s)
    s = re.sub(r'(?i)([\w.})])power\b', r'\1 power', s)
    s = re.sub(r'(?i)([\w.})])root\b', r'\1 root', s)
    s = re.sub(r'(?i)\b(\d+)over\b', r'\1 over', s)
    s = re.sub(r'([\w.})])to(?=\s+(?:power\b|[-(\w\\].*?\bpower\b))', r'\1 to', s)

    # 1. parentheses words (a leading "parenthesis" opens, otherwise closes)
    s = re.sub(r'(?i)\bopen outer parenthesis\b', '(', s)
    s = re.sub(r'(?i)\bclose outer parenthesis\b', ')', s)
    s = re.sub(r'(?i)\bopen inner parenthesis\b', '(', s)
    s = re.sub(r'(?i)\bclose inner parenthesis\b', ')', s)
    s = re.sub(r'(?i)\bopen parenthesis\b', '(', s)
    s = re.sub(r'(?i)\bclose parenthesis\b', ')', s)
    s = re.sub(r'(?i)^\s*parenthesis\b', '(', s)
    s = re.sub(r'(?i)\bparenthesis\b', ')', s)

    # 2. relations / symbols
    s = re.sub(r'(?i)\bnot equal to\b', r'\\neq', s)
    s = re.sub(r'(?i)\bapproximately equal to\b', r'\\approx', s)
    s = re.sub(r'(?i)\bequal to\b', '=', s)
    s = re.sub(r'(?i)\bdot dot dot\b', r'\\dots', s)
    s = re.sub(r'(?i)\bpercent\b', r'\\%', s)
    # currency in math mode: "$14,000" -> "\$14,000"; bare "%" -> "\%"
    s = re.sub(r'(?<!\\)\$', r'\\$', s)
    s = re.sub(r'(?<!\\)%', r'\\%', s)
    # glued commands: "-15\lea\le7" -> "-15 \le a \le 7", "14\cdotx" ->
    # "14 \cdot x", "V=\pir^{2}h" -> "V=\pi r^{2}h". Whole-word scan:
    # anything already a known LaTeX command (\leq, \times, \frac…) is left
    # alone; an unknown word gets its longest known prefix split off.
    s = GLUED_RX.sub(_unglue, s)

    # 3. spoken fractions -> \frac{n}{d} (before "raised to one fourth power")
    for phrase in sorted(FRAC_WORDS, key=len, reverse=True):
        n, d = FRAC_WORDS[phrase]
        s = re.sub(rf'(?i)\b{re.escape(phrase)}\b', rf'\\frac{{{n}}}{{{d}}}', s)

    # 4. "fraction with numerator N , denominator D" (+ optional EndFraction)
    s = re.sub(
        r'(?i)fraction with numerator\s+(.+?)\s*,\s*denominator\s+(.+?)(?:\s+fraction\b|(?=\s*[=<>+]|$))',
        lambda m: f'\\frac{{{m.group(1).strip()}}}{{{m.group(2).strip()}}}', s)
    # 5. "fraction N over D fraction" (before the over-rule; squared/cubed
    #    inside N/D are converted inline so D can't swallow them)
    def _sq(t: str) -> str:
        t = re.sub(r'(\((?:[^()]|\([^()]*\))*\))\s+squared\b', r'\1^{2}', t)
        t = re.sub(r'(\((?:[^()]|\([^()]*\))*\))\s+cubed\b', r'\1^{3}', t)
        t = re.sub(r'([\w.}])\s+squared\b', r'\1^{2}', t)
        t = re.sub(r'([\w.}])\s+cubed\b', r'\1^{3}', t)
        return t.strip()
    s = re.sub(
        r'(?i)\bfraction\s+((?:(?!\bfraction\b).)+?)\s+over\s+((?:(?!\bfraction\b).)+?)\s+fraction\b',
        lambda m: f'\\frac{{{_sq(m.group(1))}}}{{{_sq(m.group(2))}}}', s)
    # spurious wrappers: "\frac{with \frac{..." / "fraction with \frac" /
    # "with \frac" junk prefixes (before the nesting repairs below)
    s = re.sub(r'\\frac\{with\s+', '', s)
    s = re.sub(r'(?i)fraction with\s+(?=\\frac)', '', s)
    s = re.sub(r'(?i)\bwith\s+(?=\\frac)', '', s)
    # 6. garbled nesting: "{X = [-] fraction N}{D}" -> "{X} = [-]\frac{N}{D}"
    #    (X must not span a "}{" group boundary)
    s = re.sub(r'\{([^{}]+?) = (-?) fraction ([\d.]+)\}\{([\d.]+)\}',
               lambda m: f'{{{m.group(1)}}} = {m.group(2)}\\frac{{{m.group(3)}}}{{{m.group(4)}}}', s)
    s = re.sub(r'= (-?) fraction ([\d.]+)\}\{([\d.]+)\}',
               lambda m: f'= {m.group(1)}\\frac{{{m.group(2)}}}{{{m.group(3)}}}', s)
    s = re.sub(r'= fraction ([\d.]+)\}\{([\d.]+) = ([\d.]+)\}',
               lambda m: f'= \\frac{{{m.group(1)}}}{{{m.group(2)}}} = {m.group(3)}', s)
    s = re.sub(r'= (-?\s*[\d.]+)\}\{([\d.]+) = (-?\s*[\d.]+)\}$',
               lambda m: f'= \\frac{{{m.group(1).strip()}}}{{{m.group(2)}}} = {m.group(3).strip()}', s)
    # 7. alttext comma between brace groups. "\sqrt{3} ,}{3}" -> "\sqrt{3}}{3}"
    # (comma junk between two complete groups); "\frac{A} ,}{B}" ->
    # "\frac{A}{B}" (closing brace slipped before the comma). Plain exponent
    # groups ("v^{2} ,}{L}") are left for the ",}" rule below.
    s = re.sub(r'\\sqrt(?:\[\w+\])?\{([^{}]*)\}\s*,\s*(?=\}\{)',
               lambda m: f'\\sqrt{{{m.group(1)}}}', s)
    s = re.sub(r'\\frac\{([^{}]*)\}\s*,\s*\}\{',
               lambda m: f'\\frac{{{m.group(1)}}}{{', s)
    # the alttext comma inside \frac{N ,}{D}
    s = re.sub(r',\s*\}', '}', s)
    # stray EndFraction marker words
    s = re.sub(r'(?i)\s+fraction\b', '', s)
    s = re.sub(r'(?i)^fraction\s+', '', s)

    # 8. "X over Y" single tokens -> \frac{X}{Y}
    s = re.sub(r'(\\?[a-zA-Z]+|\d+(?:\.\d+)?)\s+over\s+(-?\s*(?:\\?[a-zA-Z]+|\d+(?:\.\d+)?))',
               lambda m: f'\\frac{{{m.group(1)}}}{{{m.group(2).replace(" ", "")}}}', s)

    # 9. roots — most specific first. The body must not cross a \( boundary
    # (rationales with slipped delimiters contain prose between fragments).
    _B = r'((?:(?!\\\().)+?)'
    def _root(idx):
        def repl(m: re.Match) -> str:
            body = m.group(1).strip()
            return f'\\sqrt[{idx}]{{{body}}}' if idx else f'\\sqrt{{{body}}}'
        return repl
    s = re.sub(r'(?i)\bsquare root\s+' + _B + r'\s+cubed root\b',
               lambda m: f'\\sqrt{{{m.group(1).strip()}^{{3}}}}', s)
    s = re.sub(r'(?i)\bsquare root\s+' + _B + r'\s+squared root\b',
               lambda m: f'\\sqrt{{{m.group(1).strip()}^{{2}}}}', s)
    s = re.sub(r'(?i)\bnth root\s+' + _B + r'\s+root\b', _root('n'), s)
    s = re.sub(r'(?i)\bfourth root\s+' + _B + r'\s+root\b', _root('4'), s)
    s = re.sub(r'(?i)\bcubed? root\s+' + _B + r'\s+root\b', _root('3'), s)
    s = re.sub(r'(?i)\bsquare root\s+' + _B + r'\s+root\b', _root(''), s)
    # trailing EndRoot marker after an existing \sqrt{...}
    # a \frac directly before the marker means the enclosing radical lost its
    # closing brace in transcription — the marker supplies it
    s = re.sub(r'(\\frac\{[^{}]*\}\{[^{}]*\})\s+root\b', r'\1}', s)
    s = re.sub(r'\}\s+root\b', '}', s)
    # digit glued to EndRoot inside braces: "\sqrt{3 root x}" -> "\sqrt{3x}"
    s = re.sub(r'(\d)\s+root\s+(?=[a-zA-Z])', r'\1', s)
    # "square root of X" / "square root 40" / "square root 2 3" (no marker)
    s = re.sub(r'(?i)\bthe square root of\s+([^,;]+?)(?=,|;|$)', r'\\sqrt{\1}', s)
    s = re.sub(r'(?i)\bsquare root of\s+([^,;]+?)(?=,|;|$)', r'\\sqrt{\1}', s)
    s = re.sub(r'(?i)\bsquare root\s+(\d+(?:\s+\d+)?)\s*$',
               lambda m: f'\\sqrt{{{m.group(1).replace(" ", "")}}}', s)
    s = re.sub(r'(?i)\bsquare root\s+(\d+)(?=[\s}])', r'\\sqrt{\1}', s)
    s = re.sub(r'(?i)\bsquare root\s+([a-zA-Z])(?=\s*\})', r'\\sqrt{\1}', s)
    # "{X =}" brace slipping: "\sqrt{44 =}" -> "\sqrt{44} ="
    s = re.sub(r'\{([^{}]*) =\}', r'{\1} =', s)

    # 10. powers
    # "X to power Y (power|root|}|$)"
    s = re.sub(r'(?i)\bto\s+power\s+((?:[^{}]|\{[^{}]*\})+?)\s*(?:\bpower\b|\broot\b|$)',
               lambda m: f'^{{{m.group(1).strip()}}}', s)
    s = re.sub(r'(?i)\bto\s+power\s+((?:[^{}]|\{[^{}]*\})+?)\s*\}',
               lambda m: f'^{{{m.group(1).strip()}}}}}', s)
    # "X raised to fraction a}{b power" (before the generic rule)
    s = re.sub(r'(?i)raised to fraction\s+(\w)\s*\}\s*\{(\w)\s+power\b',
               r'^{\\frac{\1}{\2}}', s)
    # "X raised to Y power"
    s = re.sub(_BASE + r'\s+raised to\s+(.+?)\s*power\b',
               lambda m: f'{m.group(1).strip()}^{_brace_y(m.group(2))}', s)
    # "\frac{r}{100 ) to t power}" — paren slipped inside the \frac
    s = re.sub(r'\{([^{}]*?) \) to (\w) power\}',
               lambda m: f'{{{m.group(1)}}})^{{{m.group(2)}}}}}', s)
    # "X to fourth power" (word ordinals)
    def _ordinal_repl(m: re.Match) -> str:
        return f'{m.group(1).strip()}^{{{ORDINALS[m.group(2).lower()]}}}'
    s = re.sub(_BASE + r'\s+to\s+(' + _ORDINAL_ALT + r')\s+power\b', _ordinal_repl, s)
    # "X to - \frac{1}{3} power"
    s = re.sub(_BASE + r'\s+to\s+(-?\s*\\frac\{[^{}]*\}\{[^{}]*\})\s+power\b',
               lambda m: f'{m.group(1).strip()}^{{{m.group(2).replace(" ", "")}}}', s)
    # "X to -1 power" (numeric)
    s = re.sub(_BASE + r'\s+to\s+(-?\s*[\d.]+)\s+power\b',
               lambda m: f'{m.group(1).strip()}^{{{m.group(2).replace(" ", "")}}}', s)
    # "X to t power" / "X to -x power" (single letter)
    s = re.sub(_BASE + r'\s+to\s+(-?\s*[a-zA-Z])\s+power\b',
               lambda m: f'{m.group(1).strip()}^{{{m.group(2).replace(" ", "")}}}', s)

    # 11. squared / cubed — parenthesized group first, then single token;
    #     "...{2 ) squared}" — paren slipped inside the preceding brace group
    s = re.sub(r'\{([^{}]*?) \) squared\}', lambda m: f'{{{m.group(1)}}})^{{2}}}}', s)
    s = re.sub(r'\{([^{}]*?) \) cubed\}', lambda m: f'{{{m.group(1)}}})^{{3}}}}', s)
    s = re.sub(r'(\((?:[^()]|\([^()]*\))*\))\s+squared\b', r'\1^{2}', s)
    s = re.sub(r'(\((?:[^()]|\([^()]*\))*\))\s+cubed\b', r'\1^{3}', s)
    s = re.sub(r'([\w.}])\s+squared\b', r'\1^{2}', s)
    s = re.sub(r'([\w.}])\s+cubed\b', r'\1^{3}', s)

    # 11b. radicals that closed early — fold the tail back in (runs AFTER the
    # power rules so "y to eighth power root" is "y^{8} root" by now):
    # "\sqrt{...} + a + b root", "\sqrt{...} \times Y root", "\sqrt{...} - 4a c root"
    _SQ = r'\\sqrt\{((?:[^{}]|\{[^{}]*\})*)\}'
    s = re.sub(_SQ + r'\s*((?:\+\s*[\d.]+\s*)+)root\b',
               lambda m: f'\\sqrt{{{m.group(1)} + {m.group(2).strip()}}}', s)
    s = re.sub(_SQ + r'\s*(\\times\s*[\w{}.^{}\s]+?)\s+root\b',
               lambda m: f'\\sqrt{{{m.group(1)} {m.group(2).strip()}}}', s)
    s = re.sub(_SQ + r'\s+([+\-]\s*[\w.]+(?:\s+[\w.]+)*?)\s+root\b',
               lambda m: f'\\sqrt{{{m.group(1)} {m.group(2).strip()}}}', s)
    s = re.sub(_SQ + r'\s+([\w.]+\^\{[^{}]*\})\s+root\b',
               lambda m: f'\\sqrt{{{m.group(1)} {m.group(2)}}}', s)
    # "... \sqrt{(} X root , denominator D =" — slipped frac inside a \frac
    s = re.sub(r'\\sqrt\{\(\}\s*(.+?)\s+root\s*,\s*denominator\s+(.+?)\s*=',
               lambda m: '\\sqrt{(' + m.group(1).strip() + '}}{' + m.group(2).strip() + '} =', s)
    s = re.sub(r'(?i)\bwith\s+numerator\s+', '', s)
    s = re.sub(r'= ((?:(?!\\frac).)+?)\}\{(\d+)\}?$',
               lambda m: f'= \\frac{{{m.group(1).strip()}}}{{{m.group(2)}}}', s)
    s = re.sub(r'= ([^{}]+?)\}\{([^{}]+)\}',
               lambda m: f'= \\frac{{{m.group(1).strip()}}}{{{m.group(2).strip()}}}', s)

    # 12. subscripts / line segments / digit words / units
    # repair earlier double-wrap damage: "\text{\text{ X }}" -> "\text{ X}"
    # (compounding across runs nested these several levels deep — loop; the
    # outer wrap may span several spans: "\text{\text{cubic} \text{cm}}")
    while '\\text{\\text{' in s:
        ns = re.sub(
            r'\\text\{\s*(\\text\{(?:[^{}]|\{[^{}]*\})*\})((?:[^{}]|\{[^{}]*\})*)\}',
            r'\1\2', s)
        if ns == s:
            break
        s = ns
    # unit words -> \text{...}, skipping spans already inside \text{...}
    def _units(part: str) -> str:
        for phrase in UNIT_PHRASES:
            part = re.sub(rf'(?i)(?<![\\a-zA-Z]){re.escape(phrase)}\b',
                          rf'\\text{{ {phrase} }}', part)
        for unit in UNITS:
            part = re.sub(rf'(?i)(?<![\\a-zA-Z]){unit}\b',
                          rf'\\text{{ {unit} }}', part)
        return part
    parts = _TEXTSPAN_RX.split(s)
    spans = _TEXTSPAN_RX.findall(s)
    s = ''.join(p for pair in zip(map(_units, parts), spans + ['']) for p in pair)
    s = re.sub(r'RootIndex\s+(\w+)\s*\\sqrt\{', r'\\sqrt[\1]{', s)
    s = re.sub(r'Superscript\s+(-?[\w.{}\\ ]+?)\s*Baseline', r'^{\1}', s)
    s = re.sub(r'\bSuperscript\b', '^', s)
    s = re.sub(r'\bBaseline\b', '', s)
    s = re.sub(r'\bdot\b', r'\\cdot', s)
    s = re.sub(r'(?i)(\w)\s+subscript\s+(\w)', r'\1_{\2}', s)
    s = re.sub(r'(?i)\bsubscript\b', '', s)
    s = re.sub(r'(?i)length (?:line segment|side)((?:\s+[A-Z])+)',
               lambda m: m.group(1).replace(' ', ''), s)
    s = re.sub(r'(?i)\bzero\b', '0', s)

    # 13. nested \frac{\sqrt{A}{B}} family — the numerator's closing brace
    # slipped out: "\frac{\sqrt{y}{\sqrt[3]{x^{2}}}}" -> "\frac{\sqrt{y}}{\sqrt[3]{x^{2}}}"
    # (must run BEFORE the balance strip, which would eat the evidence)
    _NEST2 = r'(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*'
    s = re.sub(
        r'\\frac\{(((?:[^{}]|\{[^{}]*\})*?)\\sqrt\{[^{}]*)\}\{(' + _NEST2 + r')\}\}?',
        lambda m: '\\frac{' + m.group(1) + '}}{' + m.group(3) + '}', s)

    # 14. brace balance: strip unmatched trailing '}'s left by slipped parens
    if s.count('}') > s.count('{'):
        excess = s.count('}') - s.count('{')
        while excess > 0 and s.rstrip().endswith('}'):
            s = s.rstrip()[:-1]
            excess -= 1

    # 15. tidy spacing
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\{ ', '{', s)
    s = re.sub(r' \}', '}', s)
    return s.strip()


MATH_SEG_RE = re.compile(r'\\\((.+?)\\\)', re.S)

# Slipped delimiters from the harvest: "10\(^{5}" or "(*a* + *c*)\(^{3}" —
# the "\(" landed between a base and its exponent instead of before the base,
# leaving every later segment mispaired. Pull the preceding token (a paren
# group or a word/number) inside and close right after the exponent.
SLIP_RE = re.compile(r'(\((?:[^()]|\([^()]*\))*\)|\*[\w. ]+\*|[\w.*]+)\\\(([\^_])\{([^{}]+)\}(?:\\\))?')


def _unslip(m: re.Match) -> str:
    base = m.group(1).replace('*', '')
    # the base may wrap an already-repaired segment: "(\(X\))" -> "(X)"
    inner = re.fullmatch(r'\(\\\((.*?)\\\)\)', base, re.S)
    if inner:
        base = '(' + inner.group(1) + ')'
    exp = m.group(3).replace('*', '')
    return '\\(' + base + m.group(2) + '{' + exp + '}\\)'


def _close_dangling(text: str) -> str:
    """Repair fields where transcription lost the closing "\\)".
    Only runs when the field's \\( \\) counts are unbalanced."""
    if text.count('\\(') <= text.count('\\)'):
        return text
    # isotope superscripts left open: "\(^{87}Sr" -> "\(^{87}Sr\)"
    text = re.sub(r'\\\((\^\{[^{}]*\}|\^\w+)([A-Z][a-z]?)', r'\\(\1\2\\)', text)
    # "\(" closed by a plain ")": "(\(^{13}C)" -> "(\(^{13}C\))",
    # "PH\(_{3})" -> "PH\(_{3}\))". The content may not end with a backslash,
    # which keeps balanced "(\(x\))" untouched.
    text = re.sub(r'\\\(([^()\n]*?[^()\n\\])\)', r'\\(\1\\))', text)
    return text


def clean_text(text: str) -> str:
    """Apply clean_math to every \\(...\\) segment in a content string."""
    # stray asterisks jammed against a slipped exponent marker: "*p**\(^{2}"
    text = re.sub(r'\*+(?=\\\(\^)', '', text)
    while True:
        unslipped = SLIP_RE.sub(_unslip, text)
        if unslipped == text:
            break
        text = unslipped
    # nested math delimiters: "\((\(\theta\) – 27)^{2}\)" -> "\((\theta – 27)^{2}\)"
    text = re.sub(r'\\\(\(\\\(([^()]+?)\\\)', r'\\((\1', text)
    text = _close_dangling(text)
    # stray italic marker glued to a math segment: "*\(x^{2}" -> "\(x^{2}\)"
    # (but keep the intentional *\(x\)* italic-wrapped math)
    text = re.sub(r'\*\\\(([^()]+?)\\\)(?!\*)', r'\\(\1\\)', text)
    return MATH_SEG_RE.sub(lambda m: '\\(' + clean_math(m.group(1)) + '\\)', text)


# --- residual detection --------------------------------------------------------

RESIDUAL_RE = re.compile(
    r'(?<!\\)\b(root|squared|cubed|power|raised|fraction|numerator|denominator|'
    r'subscript|parenthesis|percent|approximately|equal to|over)\b', re.I)


def residuals(seg: str) -> list[str]:
    return sorted(set(w.lower() for w in RESIDUAL_RE.findall(seg)))

"""Markdown cleanup for RSVP reading.

Pure functions, no I/O. Turns raw Markdown (what agents actually write) into a
flat list of `Segment`s -- one per displayed word/placeholder -- so the reader
shows "important" instead of "**important**", "ui/panel.mjs" instead of a
60-character absolute path, "[link: github.com]" instead of a full URL, and so
on. `tokenizer.py` turns segments into tokens (adds the pause multipliers).

Every rule is configurable through `CleanSettings` (the Settings screen sends
one). Rules were designed against ~14k real messages, with these protections
(each one exists because a plausible-looking rule would have damaged real text):

* `snake_case`, `*.py`, `--include=*`, `2*3` are never treated as emphasis;
* a word with one slash (`incidente/manutenção`, `e/ou`) or a date (`02/09`)
  is never treated as a path;
* an HTML-looking word that is not in the small known list (`<head>`) is kept;
* inline code that is a quoted phrase is read, not collapsed;
* a table is only a table with a header line followed by a `|---|` separator.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, fields
from urllib.parse import urlsplit

#: Pause multipliers shared with tokenizer.py (applied on top of 60000/wpm ms).
SENTENCE_END_MULT = 2.4
COMMA_MULT = 1.5
LONG_WORD_MULT = 1.15
LONG_WORD_THRESHOLD = 8

_SENTENCE_END_RE = re.compile(r"[.!?]$")
_COMMA_RE = re.compile(r"[,;:]$")


def base_mult(text: str, kind: str = "word") -> tuple[float, bool]:
    """Pause multiplier + is-sentence-end for one displayed word."""
    is_sentence_end = bool(_SENTENCE_END_RE.search(text))
    mult = 1.0
    if is_sentence_end:
        mult = SENTENCE_END_MULT
    elif _COMMA_RE.search(text):
        mult = COMMA_MULT
    if kind == "word" and len(text) > LONG_WORD_THRESHOLD:
        mult *= LONG_WORD_MULT
    return mult, is_sentence_end


# --------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------

#: option -> allowed values (first = default for that option).
CHOICES: dict[str, tuple[str, ...]] = {
    "mode": ("clean", "raw"),
    "emphasis": ("bold", "plain", "raw"),
    "headings": ("clean", "raw"),
    "lists": ("clean", "raw"),
    "list_pause": ("comma", "sentence", "none"),
    "inline": ("smart", "read", "code"),
    "blocks": ("diff", "summary"),
    "tables": ("auto", "collapse", "read"),
    "links": ("text", "textdom"),
    "urls": ("dom1", "dom", "full", "hide"),
    "paths": ("parent", "base", "full", "ph"),
    "hashes": ("short", "ph", "full"),
    "html": ("clean", "keep"),
    "options": ("hide", "read", "keep"),
    "lang": ("en", "pt"),
    "split_long": ("on", "off"),
}

#: option -> (default, min, max)
NUMBERS: dict[str, tuple[float, float, float]] = {
    "table_rows": (6, 1, 60),
    "table_cols": (4, 1, 12),
    "pause_emphasis": (1.2, 0.5, 4.0),
    "pause_headings": (2.4, 0.5, 6.0),
    "pause_blocks": (2.4, 0.5, 6.0),
    "pause_tables": (2.4, 0.5, 6.0),
    "pause_urls": (1.5, 0.5, 6.0),
    "pause_item_start": (1.3, 0.5, 3.0),
    "long_word_len": (20, 8, 60),
    "pause_hard": (1.25, 1.0, 3.0),
}


@dataclass(frozen=True)
class CleanSettings:
    mode: str = "clean"
    emphasis: str = "bold"
    headings: str = "clean"
    lists: str = "clean"
    list_pause: str = "comma"
    inline: str = "smart"
    blocks: str = "diff"
    tables: str = "auto"
    links: str = "text"
    urls: str = "dom1"
    paths: str = "parent"
    hashes: str = "short"
    html: str = "clean"
    options: str = "hide"
    lang: str = "en"
    table_rows: int = 6
    table_cols: int = 4
    pause_emphasis: float = 1.2
    pause_headings: float = 2.4
    pause_blocks: float = 2.4
    pause_tables: float = 2.4
    pause_urls: float = 1.5
    pause_item_start: float = 1.3
    split_long: str = "on"
    long_word_len: int = 20
    pause_hard: float = 1.25

    @classmethod
    def from_dict(cls, raw) -> "CleanSettings":
        """Build settings from untrusted JSON. Unknown keys are ignored and any
        missing/invalid/out-of-range value falls back to the default, so a bad
        client can never cause an error -- only get the default behaviour."""
        if not isinstance(raw, dict):
            return cls()
        values: dict = {}
        for name, allowed in CHOICES.items():
            v = raw.get(name)
            if isinstance(v, str) and v in allowed:
                values[name] = v
        for name, (default, lo, hi) in NUMBERS.items():
            v = raw.get(name)
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                continue
            if v != v:  # NaN
                continue
            v = max(lo, min(hi, v))
            values[name] = int(v) if isinstance(default, int) else float(v)
        return cls(**values)

    def as_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}


DEFAULTS = CleanSettings()


# --------------------------------------------------------------------------
# segments
# --------------------------------------------------------------------------

@dataclass
class Segment:
    """One displayed token before pause computation."""

    text: str
    kind: str = "word"  # word | code | link | image | table | widget | file | id
    emphasis: bool = False
    mult: float | None = None  # explicit pause override (None = derive from text)
    sentence_end: bool | None = None  # explicit override (None = derive from text)
    block: bool = False  # a whole code block collapsed into one token
    # --- layout (display only; the reader itself ignores it) ---
    brk: int = 0  # line break before this token: 0 none, 1 new line, 2 blank line (paragraph)
    line: str = ""  # kind of the line this token sits on: h | li | q | th | tr | block | ""
    bullet: str = ""  # list marker ("\u2022", "3.", "\u2610") on the first token of a list item
    indent: int = 0  # nesting level of a list item
    # --- list position (for the "item 3/5" chip); 0 / "" = not in a list ---
    list_item: int = 0  # 1-based number of the top-level item this token belongs to
    list_sub: int = 0  # 1-based number of the sub-item inside that item (0 = the item itself)
    list_size: int = 0  # how many top-level items the list has
    list_title: str = ""  # the line that introduces the list ("Para cada fonte de contato")


_LABELS = {
    "en": dict(code="code", line="line", lines="lines", table="table", row="row", rows="rows",
               cols="cols", image="image", widget="widget", file="file", id="id", link="link",
               options="Options", files="files"),
    "pt": dict(code="código", line="linha", lines="linhas", table="tabela", row="linha", rows="linhas",
               cols="colunas", image="imagem", widget="widget", file="arquivo", id="id", link="link",
               options="Opções", files="arquivos"),
}


def _labels(S: CleanSettings) -> dict:
    return _LABELS[S.lang]


# Control characters used as in-band markers while a line is being processed.
# They are stripped from the input first so real text can never collide.
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
EM_ON, EM_OFF = "\x01", "\x02"
K_CODE, K_LINK, K_IMAGE, K_TABLE, K_WIDGET, K_FILE, K_ID, VERB = (
    "\x10", "\x11", "\x12", "\x13", "\x14", "\x15", "\x16", "\x17",
)
_KIND_BY_MARK = {
    K_CODE: "code", K_LINK: "link", K_IMAGE: "image", K_TABLE: "table",
    K_WIDGET: "widget", K_FILE: "file", K_ID: "id",
}
NBSP = "\u00a0"


def _ph(mark: str, text: str) -> str:
    """In-line placeholder: kept as ONE word (spaces -> NBSP) and tagged with a kind."""
    return mark + text.replace(" ", NBSP)


# --------------------------------------------------------------------------
# block level: fences
# --------------------------------------------------------------------------

_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")


def _fence_open(line: str):
    m = _FENCE_RE.match(line)
    if not m:
        return None
    marker, rest = m.group(1), m.group(2)
    if marker[0] == "`" and "`" in rest:
        return None  # "```code```" on one line is inline code, not a fence
    lang = rest.strip().split(" ")[0] if rest.strip() else ""
    return marker, lang


def _split_blocks(text: str) -> list[tuple]:
    """-> [("text", [lines]) | ("code", lang, [lines])]. An unclosed fence runs to the end."""
    blocks: list[tuple] = []
    cur: list[str] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        opened = _fence_open(lines[i])
        if opened is None:
            cur.append(lines[i])
            i += 1
            continue
        marker, lang = opened
        if cur:
            blocks.append(("text", cur))
            cur = []
        body: list[str] = []
        i += 1
        while i < len(lines):
            s = lines[i].strip()
            if s and set(s) == {marker[0]} and len(s) >= len(marker):
                i += 1
                break
            body.append(lines[i])
            i += 1
        blocks.append(("code", lang, body))
    if cur:
        blocks.append(("text", cur))
    return blocks


def _short_path(path: str, S: CleanSettings) -> str:
    parts = [p for p in path.split("/") if p]
    if S.paths == "full" or len(parts) <= 2:
        return path
    return "/".join(parts[-2:]) if S.paths != "base" else parts[-1]


def _diff_summary(lines: list[str], S: CleanSettings) -> str:
    L = _labels(S)
    added = removed = 0
    files: list[str] = []
    for ln in lines:
        if ln.startswith("+++ ") or ln.startswith("--- "):
            name = ln[4:].split("\t")[0].strip()
            if name in ("/dev/null", ""):
                continue
            if name[:2] in ("a/", "b/"):
                name = name[2:]
            if ln.startswith("+++ ") or name not in files:
                if name not in files:
                    files.append(name)
        elif ln.startswith("+"):
            added += 1
        elif ln.startswith("-"):
            removed += 1
    stats = f"+{added} \u2212{removed}"
    if len(files) == 1:
        return f"diff: {_short_path(files[0], S)}, {stats}"
    if len(files) > 1:
        return f"diff: {len(files)} {L['files']}, {stats}"
    return f"diff: {stats}"


def _looks_like_diff(lines: list[str]) -> bool:
    has_minus = any(ln.startswith("--- ") for ln in lines)
    has_plus = any(ln.startswith("+++ ") for ln in lines)
    return (has_minus and has_plus) or any(ln.startswith("@@ ") for ln in lines)


def _code_block_segment(lang: str, lines: list[str], S: CleanSettings) -> Segment:
    L = _labels(S)
    n = len(lines)
    if S.blocks == "diff" and (lang.lower() in ("diff", "patch") or _looks_like_diff(lines)):
        text = _diff_summary(lines, S)
    else:
        noun = L["line"] if n == 1 else L["lines"]
        text = f"{L['code']}: {lang}, {n} {noun}" if lang else f"{L['code']}, {n} {noun}"
    return Segment(f"[{text}]", kind="code", mult=S.pause_blocks, sentence_end=True, block=True, line="block")


# --------------------------------------------------------------------------
# inline level
# --------------------------------------------------------------------------

_ESC_RE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|~<>])")
_CODE_SPAN_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_LINK_RE = re.compile(r"(?<![\w\]])\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_URL_RE = re.compile(r"https?://[^\s<>\x00-\x1f]+")
_URL_TRAIL = ".,;:!?)]}'\""
_SENT_RE = re.compile(r"\x00(\d+)\x00")
_CODE_CHARS_RE = re.compile(r"[(){}\[\]=;<>$&|\\]|=>|->|\+\+")

_EM_PATTERNS = [
    # bold / bold-italic with stars: must hug non-space text, not touch word chars
    (re.compile(r"(?<![\w*])\*{2,3}(?=[^\s*])(.+?)(?<=[^\s*])\*{2,3}(?![\w*])"), EM_ON + r"\1" + EM_OFF),
    # __bold__ only for multi-word text (single-word __init__ is a Python name)
    (re.compile(r"(?<![\w_])__(?=[^\s_])([^_\n]*\s[^_\n]*?)(?<=[^\s_])__(?![\w_])"), EM_ON + r"\1" + EM_OFF),
    # ~~strike~~ -> plain text
    (re.compile(r"~~(?=\S)(.+?)(?<=\S)~~"), r"\1"),
    # *italic*: must start with a letter/digit/quote/paren, so globs (*.py) never match
    (re.compile(r"(?<![\w*])\*(?=[A-Za-z0-9\u00c0-\u024f\"'(])([^*\n]+?)(?<=[^\s*=])\*(?![\w*])"),
     EM_ON + r"\1" + EM_OFF),
    # _italic_: single underscores, not inside identifiers and not followed by ".ext"
    (re.compile(r"(?<![\w])_(?=[A-Za-z0-9\u00c0-\u024f\"'(])([^_\n]+?)(?<=[^\s_=])_(?!\w|\.\w)"),
     EM_ON + r"\1" + EM_OFF),
]


class _Ctx:
    def __init__(self, S: CleanSettings):
        self.S = S
        self.items: list[tuple] = []

    def mask(self, item: tuple) -> str:
        self.items.append(item)
        return f"\x00{len(self.items) - 1}\x00"


def _mark_emphasis(text: str, S: CleanSettings) -> str:
    if S.emphasis == "raw":
        return text
    for pattern, repl in _EM_PATTERNS:
        text = pattern.sub(repl, text)
    return text


def _resolve_url(url: str, S: CleanSettings) -> str:
    if S.urls == "hide":
        return ""
    if S.urls == "full":
        return VERB + url
    try:
        parts = urlsplit(url)
    except ValueError:
        return VERB + url
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return VERB + url
    label = host
    if S.urls == "dom1":
        seg = next((p for p in parts.path.split("/") if p), "")
        if seg:
            label = f"{host}/{seg}"
    return _ph(K_LINK, f"[{_labels(S)['link']}: {label}]")


def _resolve(item: tuple, ctx: _Ctx) -> str:
    S = ctx.S
    L = _labels(S)
    tag = item[0]
    if tag == "lit":
        return item[1]
    if tag == "url":
        return _resolve_url(item[1], S)
    if tag == "image":
        alt = item[1].strip()
        return _ph(K_IMAGE, f"[{L['image']}: {alt}]" if alt else f"[{L['image']}]")
    if tag == "link":
        inner, target = item[1], item[2]
        if re.match(r"https?://", inner.strip()):
            return _resolve_url(inner.strip(), S)
        out = _expand(_mark_emphasis(inner, S), ctx)
        if S.links == "textdom":
            try:
                host = (urlsplit(target).hostname or "").lower()
            except ValueError:
                host = ""
            if host.startswith("www."):
                host = host[4:]
            if host:
                out += " " + _ph(K_LINK, f"[{host}]")
        return out
    if tag == "code":
        content = item[1].replace("\\|", "|").strip()
        if not content:
            return ""
        if re.fullmatch(r"https?://\S+", content):
            return _resolve_url(content, S)
        words = content.split()
        if len(words) <= 1:
            return content
        looks_code = bool(_CODE_CHARS_RE.search(content))
        if S.inline == "read":
            collapse = False
        elif S.inline == "code":
            collapse = True
        else:  # smart: only snippets that look like code (or are very long)
            collapse = looks_code or len(words) > 12
        if collapse:
            return _ph(K_CODE, f"[{L['code']}]")
        return content
    return ""


def _expand(s: str, ctx: _Ctx) -> str:
    return _SENT_RE.sub(lambda m: _resolve(ctx.items[int(m.group(1))], ctx), s)


_EDGE_RE = re.compile(r"^([(\"'\[<\u201c\u2018]*)(.*?)([)\"'\]>.,;:!?\u201d\u2019\u2026]*)$", re.S)
_DROP_ALWAYS_RE = re.compile(r"^(?:\|+|>+|_{3,})$")
_DROP_HEADING_RE = re.compile(r"^#{1,6}$")
_DROP_LIST_RE = re.compile(r"^(?:-{1,3}|\*{1,3})$")
_ARROWS = {"->": "\u2192", "-->": "\u2192", "=>": "\u2192", "<-": "\u2190", "<--": "\u2190"}
_HEX_RE = re.compile(r"^[0-9a-f]{7,40}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_LOC_RE = re.compile(r"^(.*?)(:\d+(?::\d+)?)?$", re.S)
_SEG = r"[\w.@+~%\-]+"
_ABS_PATH_RE = re.compile(rf"^(?:~|\.{{1,2}})?/{_SEG}(?:/{_SEG})*/?$")
_REL_PATH_RE = re.compile(rf"^{_SEG}(?:/{_SEG}){{2,}}/?$")
_HAS_EXT_RE = re.compile(r"\.\w{1,8}$")
_LEFTOVER_EM_RE = re.compile(r"^(?:\*{2,3}|~~)|(?:\*{2,3}|~~)$")


def _path_word(core: str, S: CleanSettings) -> str | None:
    """Shorten a path-looking word per settings; None = not a path (leave alone)."""
    loc_m = _LOC_RE.match(core)
    body, loc = loc_m.group(1), loc_m.group(2) or ""
    if _ABS_PATH_RE.match(body):
        pass
    elif _REL_PATH_RE.match(body) and _HAS_EXT_RE.search(body.rstrip("/")):
        pass
    else:
        return None
    parts = [p for p in body.split("/") if p not in ("", ".", "..", "~")]
    if len(parts) < 2:
        return None  # `/compact`, `./a.py`, `~/x` -- already short
    if body.startswith("/") and parts[0] == "dev":
        return None  # /dev/null and friends read fine as they are
    if S.paths == "full":
        return None
    if S.paths == "ph":
        return _ph(K_FILE, f"[{_labels(S)['file']}]")
    slash = "/" if body.endswith("/") else ""
    if S.paths == "base":
        return parts[-1] + slash + loc
    return "/".join(parts[-2:]) + slash + loc


def _transform_word(text: str, S: CleanSettings) -> str | None:
    """Word-level rules for plain words. Returns None to drop the word."""
    if S.emphasis != "raw":
        text = _LEFTOVER_EM_RE.sub("", text)
        if not text:
            return None
    if (
        _DROP_ALWAYS_RE.match(text)
        or (S.headings == "clean" and _DROP_HEADING_RE.match(text))
        or (S.lists == "clean" and _DROP_LIST_RE.match(text))
    ):
        return None
    if text in _ARROWS:
        return _ARROWS[text]
    m = _EDGE_RE.match(text)
    lead, core, trail = m.group(1), m.group(2), m.group(3)
    if not core:
        return text
    if _UUID_RE.match(core):
        if S.hashes == "short":
            return lead + core[:8] + trail
        if S.hashes == "ph":
            return lead + _ph(K_ID, f"[{_labels(S)['id']}]") + trail
        return text
    if _HEX_RE.match(core) and any(c.isdigit() for c in core) and any(c in "abcdef" for c in core):
        if S.hashes == "short":
            return lead + core[:7] + trail
        if S.hashes == "ph":
            return lead + _ph(K_ID, f"[{_labels(S)['id']}]") + trail
        return text
    if "/" in core:
        short = _path_word(core, S)
        if short is not None:
            return lead + short + trail
    return text


def _finalize(s: str, S: CleanSettings) -> list[Segment]:
    """Split a processed line (with in-band markers) into Segments."""
    segs: list[Segment] = []
    cur: list[str] = []
    em = 0
    word_em = False
    kind: str | None = None
    verbatim = False

    def flush():
        nonlocal cur, word_em, kind, verbatim
        text = "".join(cur).replace(NBSP, " ")
        had_marker_kind = kind
        if text.strip():
            if had_marker_kind is None and not verbatim:
                out = _transform_word(text, S)
            else:
                out = text
            if out is not None and out.strip():
                # a transform may have produced a placeholder carrying a marker
                k = had_marker_kind or "word"
                for mark, name in _KIND_BY_MARK.items():
                    if mark in out:
                        k = name
                        out = out.replace(mark, "")
                out = out.replace(NBSP, " ")
                segs.append(Segment(out, kind=k, emphasis=word_em))
        cur = []
        word_em = False
        kind = None
        verbatim = False

    for ch in s:
        if ch == EM_ON:
            em += 1
        elif ch == EM_OFF:
            em = max(0, em - 1)
        elif ch in _KIND_BY_MARK:
            if kind is None:
                kind = _KIND_BY_MARK[ch]
        elif ch == VERB:
            verbatim = True
        elif ch in " \t\r\n\f\v":
            flush()
        else:
            cur.append(ch)
            if em > 0:
                word_em = True
    flush()
    return segs


def _inline(text: str, S: CleanSettings) -> list[Segment]:
    ctx = _Ctx(S)
    # Order matters: an escaped backtick must not open a code span, and a
    # backslash inside a code span is literal (except the table-cell `\|`).
    text = text.replace("\\`", ctx.mask(("lit", "`")))
    text = _CODE_SPAN_RE.sub(lambda m: ctx.mask(("code", m.group(2))), text)
    text = _ESC_RE.sub(lambda m: ctx.mask(("lit", m.group(1))), text)
    text = _IMAGE_RE.sub(lambda m: ctx.mask(("image", m.group(1))), text)
    text = _LINK_RE.sub(lambda m: ctx.mask(("link", m.group(1), m.group(2))), text)

    def url_sub(m):
        url = m.group(0)
        stripped = url.rstrip(_URL_TRAIL)
        trail = url[len(stripped):]
        return ctx.mask(("url", stripped)) + trail

    text = _URL_RE.sub(url_sub, text)
    text = _mark_emphasis(text, S)
    text = _expand(text, ctx)
    return _finalize(text, S)


# --------------------------------------------------------------------------
# block level: lines, tables
# --------------------------------------------------------------------------

_HEAD_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_LIST_RE = re.compile(r"^\s*([-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$")
_QUOTE_RE = re.compile(r"^\s*(?:>\s?)+")
_HR_RE = re.compile(r"^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$")
_OPTIONS_RE = re.compile(r"^\[OPTIONS:\s*(.*)\]\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$")
_CELL_SPLIT_RE = re.compile(r"(?<!\\)\|")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_WIDGET_RE = re.compile(r"<mcwidget\b([^>]*)>.*?</mcwidget>", re.S | re.I)
_TITLE_RE = re.compile(r"title=\"([^\"]*)\"", re.I)
_BR_RE = re.compile(r"<br\s*/?>", re.I)
_DETAILS_RE = re.compile(r"</?(?:details|summary)\b[^>]*>", re.I)


def _bump(seg: Segment, minimum: float, sentence: bool = False) -> None:
    base = seg.mult if seg.mult is not None else base_mult(seg.text, seg.kind)[0]
    seg.mult = max(base, minimum)
    if sentence:
        seg.sentence_end = True


def _tag(segs: list[Segment], line: str, bullet: str = "", indent: int = 0) -> list[Segment]:
    """Mark every segment of one source line with its layout kind (display only)."""
    for seg in segs:
        seg.line = line
        seg.indent = indent
    if segs and bullet:
        segs[0].bullet = bullet
    return segs


def _line_segments(stripped: str, S: CleanSettings, indent: int = 0) -> list[Segment]:
    L = _labels(S)
    # The agent's trailing `[OPTIONS: A | B]` choice line is chrome for the chat UI,
    # not part of the answer: skipped by default, readable on request.
    m = _OPTIONS_RE.match(stripped) if S.options != "keep" else None
    if m:
        if S.options == "hide":
            return []
        items = [x.strip() for x in m.group(1).split("|") if x.strip()]
        segs = _inline(f"{L['options']}: " + ", ".join(items) + ".", S)
        if segs:
            _bump(segs[-1], SENTENCE_END_MULT, sentence=True)
        return segs

    quoted = stripped.startswith(">")
    line = _QUOTE_RE.sub("", stripped, count=1) if quoted else stripped
    if not line.strip():
        return []

    if S.headings == "clean":
        m = _HEAD_RE.match(line)
        if m:
            segs = _inline(m.group(2), S)
            if segs:
                segs[-1].mult = S.pause_headings
                segs[-1].sentence_end = True
            return _tag(segs, "h")

    if S.lists == "clean":
        m = _LIST_RE.match(line)
        if m:
            segs = _inline(m.group(3), S)
            if segs and S.list_pause != "none":
                if S.list_pause == "sentence":
                    _bump(segs[-1], SENTENCE_END_MULT, sentence=True)
                else:
                    _bump(segs[-1], COMMA_MULT)
            marker, check = m.group(1), m.group(2)
            if check is not None:
                bullet = "\u2611" if check in "xX" else "\u2610"
            else:
                bullet = marker if marker[0].isdigit() else "\u2022"
            return _tag(segs, "li", bullet, indent)

    segs = _inline(line, S)
    return _tag(segs, "q") if quoted else segs


def _split_cells(row: str) -> list[str]:
    r = row.strip()
    if r.startswith("|"):
        r = r[1:]
    if r.endswith("|") and not r.endswith("\\|"):
        r = r[:-1]
    return [c.strip() for c in _CELL_SPLIT_RE.split(r)]


def _end_punct(text: str) -> str:
    return text if re.search(r"[.!?:;]$", text) else text + "."


def _table_segments(header: str, rows: list[str], S: CleanSettings) -> list[Segment]:
    L = _labels(S)
    head_cells = _split_cells(header)
    ncols = len(head_cells)
    nrows = len(rows)
    collapse = S.tables == "collapse" or (
        S.tables == "auto" and (nrows > S.table_rows or ncols > S.table_cols)
    )
    if collapse:
        row_word = L["row"] if nrows == 1 else L["rows"]
        col_word = "col" if (ncols == 1 and S.lang == "en") else ("coluna" if ncols == 1 else L["cols"])
        text = f"[{L['table']}: {nrows} {row_word} \u00d7 {ncols} {col_word}]"
        return [Segment(text, kind="table", mult=S.pause_tables, sentence_end=True, line="block")]

    segs: list[Segment] = []
    heads = [c for c in head_cells if c]
    if heads:
        part = _inline(_end_punct(", ".join(heads)), S)
        if part:
            _bump(part[-1], SENTENCE_END_MULT, sentence=True)
            _tag(part, "th")
        segs.extend(part)
    for row in rows:
        cells = [c for c in _split_cells(row) if c]
        if not cells:
            continue
        if len(cells) == 1:
            text = _end_punct(cells[0])
        else:
            text = f"{cells[0].rstrip(':')}: " + _end_punct(", ".join(cells[1:]))
        part = _inline(text, S)
        if part:
            part[-1].mult = S.pause_tables
            part[-1].sentence_end = True
            _tag(part, "tr")
            part[0].brk = 1  # every table row on its own line
        segs.extend(part)
    return segs


def _preprocess_html(text: str, S: CleanSettings) -> str:
    if S.html != "clean":
        return text
    text = _COMMENT_RE.sub(" ", text)

    def widget(m):
        t = _TITLE_RE.search(m.group(1))
        title = t.group(1).strip() if t else ""
        label = f"[{_labels(S)['widget']}: {title}]" if title else f"[{_labels(S)['widget']}]"
        return "\n" + _ph(K_WIDGET, label) + "\n"

    text = _WIDGET_RE.sub(widget, text)
    text = _BR_RE.sub(" ", text)
    return _DETAILS_RE.sub(" ", text)


def _put_break(part: list[Segment], pending: int, minimum: int = 1) -> None:
    """The first token of a source line starts a new display line (layout only)."""
    if part:
        part[0].brk = max(part[0].brk, pending, minimum)


def _process_text_block(lines: list[str], S: CleanSettings, pending: int = 1) -> tuple[list[Segment], int]:
    """-> (segments, pending break). `pending` = break owed to the next token:
    1 after a line, 2 after a blank line / rule; it carries over between blocks."""
    if S.html == "clean":
        lines = _preprocess_html("\n".join(lines), S).split("\n")
    segs: list[Segment] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            pending = 2
            i += 1
            continue
        if (
            "|" in line
            and i + 1 < len(lines)
            and "|" in lines[i + 1]
            and _TABLE_SEP_RE.match(lines[i + 1])
        ):
            j = i + 2
            rows: list[str] = []
            while j < len(lines) and lines[j].strip() and "|" in lines[j]:
                rows.append(lines[j])
                j += 1
            part = _table_segments(line, rows, S)
            if part:
                _put_break(part, pending, 2)
                pending = 1
            segs.extend(part)
            i = j
            continue
        if _HR_RE.match(stripped):
            if segs:
                _bump(segs[-1], SENTENCE_END_MULT, sentence=True)
            pending = 2
            i += 1
            continue
        indent = min(4, (len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip(" "))) // 2)
        part = _line_segments(stripped, S, indent)
        if part:
            _put_break(part, pending, 2 if part[0].line == "h" else 1)
            pending = 1
        segs.extend(part)
        i += 1
    return segs, pending


_TITLE_MAX = 70
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _list_title(text: str) -> str:
    """Short label for the line that introduces a list."""
    t = text.strip().rstrip(":").strip()
    if len(t) <= _TITLE_MAX:
        return t
    last = _SENTENCE_SPLIT_RE.split(t)[-1].rstrip(":").strip()
    if len(last) <= _TITLE_MAX:
        return last
    cut = last[-(_TITLE_MAX - 1):]
    return "\u2026" + (cut.split(" ", 1)[1] if " " in cut else cut)


def _annotate_lists(segs: list[Segment]) -> None:
    """Number the items of every list (>= 2 top-level items) and attach the
    list's intro line, so the reader can show "item 3/5" above the focal word.
    Display metadata only -- words and pauses are not touched here."""
    lines: list[tuple[int, int]] = []  # (start, end) over segs, one per source line
    for i, seg in enumerate(segs):
        if i == 0 or seg.brk > 0:
            lines.append((i, i + 1))
        else:
            lines[-1] = (lines[-1][0], i + 1)

    k = 0
    while k < len(lines):
        if segs[lines[k][0]].line != "li":
            k += 1
            continue
        j = k
        while j < len(lines) and segs[lines[j][0]].line == "li":
            j += 1
        base = min(segs[lines[n][0]].indent for n in range(k, j))
        size = sum(1 for n in range(k, j) if segs[lines[n][0]].indent == base)
        if size >= 2:
            title = ""
            if k > 0 and segs[lines[k - 1][0]].line in ("", "h", "q"):
                a, b = lines[k - 1]
                title = _list_title(" ".join(x.text for x in segs[a:b]))
            item = sub = 0
            for n in range(k, j):
                a, b = lines[n]
                if segs[a].indent == base:
                    item += 1
                    sub = 0
                else:
                    sub += 1
                for seg in segs[a:b]:
                    seg.list_item = max(item, 1)
                    seg.list_sub = sub
                    seg.list_size = size
                    seg.list_title = title
        k = j


def clean(text: str, S: CleanSettings = DEFAULTS) -> list[Segment]:
    """Raw Markdown text -> displayed segments (settings.mode == 'raw' is handled by the caller).

    Besides the words, each segment carries layout hints (`brk`, `line`,
    `bullet`, `indent`) so the context caption can keep the chat's own
    paragraphs, lists, headings and table rows instead of one long run of text."""
    text = _CTRL_RE.sub("", text)
    segs: list[Segment] = []
    pending = 1
    for block in _split_blocks(text):
        if block[0] == "code":
            seg = _code_block_segment(block[1], block[2], S)
            seg.brk = max(pending, 1)
            segs.append(seg)
            pending = 1
        else:
            part, pending = _process_text_block(block[1], S, max(pending, 1))
            segs.extend(part)
    if segs:
        segs[0].brk = 0
        _annotate_lists(segs)
    return segs

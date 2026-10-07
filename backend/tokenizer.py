"""Text tokenization for RSVP (Rapid Serial Visual Presentation) display.

Pure, no I/O -- testable in isolation. Cleans Markdown noise (see md_clean.py),
splits text into tokens (roughly words) and computes a per-token duration
multiplier, so that sentence-ending punctuation, commas, long words, headings,
tables and code blocks get an appropriate pause.

`settings` (md_clean.CleanSettings) controls the cleanup; `None` means the
"Balanced" defaults. `settings.mode == "raw"` keeps the original behaviour
(every whitespace-separated chunk is a word, only fenced code is collapsed).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace

import md_clean
from md_clean import CleanSettings

#: Character length at or beyond which a word gets an extra pause.
LONG_WORD_THRESHOLD = md_clean.LONG_WORD_THRESHOLD

#: Pause multipliers (applied on top of the base duration of 60000/wpm ms).
SENTENCE_END_MULT = md_clean.SENTENCE_END_MULT
COMMA_MULT = md_clean.COMMA_MULT
LONG_WORD_MULT = md_clean.LONG_WORD_MULT

_CODE_FENCE_RE = re.compile(r"^```")


@dataclass
class Token:
    """An RSVP display token."""

    text: str
    mult: float = 1.0
    is_sentence_end: bool = False
    is_code_block: bool = False
    #: Index of the source message (turn), for RF5.4 (role-based marking).
    message_index: int = 0
    role: str = "assistant"
    #: word | code | link | image | table | widget | file | id -- placeholders
    #: ([code: python, 12 lines], [link: github.com]...) are not "word" so the
    #: UI can render them muted.
    kind: str = "word"
    #: Source text was emphasized (**bold**); shown in bold when the setting asks.
    emphasis: bool = False
    #: Layout hints for the context caption (the reader ignores them): line break
    #: before the token (0/1/2), kind of its source line, list marker, nesting.
    brk: int = 0
    line_kind: str = ""
    bullet: str = ""
    indent: int = 0
    #: List position for the "item 3/5" chip (0 / "" = not in a list).
    list_item: int = 0
    list_sub: int = 0
    list_size: int = 0
    list_title: str = ""
    #: Continuation of the previous token (a long word split into parts): the
    #: context caption glues it back without a space.
    cont: bool = False


def _token_for_word(word: str, message_index: int, role: str) -> Token:
    """Raw mode: a whitespace-separated chunk, paused by its own punctuation/length."""
    mult, is_sentence_end = md_clean.base_mult(word)
    return Token(text=word, mult=mult, is_sentence_end=is_sentence_end, message_index=message_index, role=role)


_SPLIT_RE = re.compile(r"(?<=[_\-/.])(?=[^_\-/.])|(?<=[a-z0-9])(?=[A-Z])")
_HARD_RE = re.compile(r"\d|_|\w\.\w|[a-z][A-Z]|/")
_EDGE_PUNCT_RE = re.compile(r"^[^\w]+|[^\w]+$")


def split_long_word(text: str, limit: int) -> list[str]:
    """Break a very long word into readable parts: first at its own separators
    (`_ - / .` and camelCase humps, kept on the left part), then, if a part is
    still too long, by length with a trailing hyphen. Short words come back as-is."""
    if len(text) <= limit:
        return [text]
    parts = [p for p in _SPLIT_RE.split(text) if p]
    merged: list[str] = []
    cur = ""
    for p in parts:
        if len(cur) + len(p) <= limit:
            cur += p
        else:
            if cur:
                merged.append(cur)
            cur = p
    if cur:
        merged.append(cur)
    out: list[str] = []
    for c in merged:
        while len(c) > limit:
            cut = limit - 1
            if len(c) - cut < 4:  # never leave a 1-3 letter tail
                cut = (len(c) + 1) // 2
            out.append(c[:cut] + "-")
            c = c[cut:]
        out.append(c)
    return out


def is_hard_word(text: str, kind: str) -> bool:
    """Numbers, identifiers, versions, paths, ids: they need a beat longer than prose."""
    if kind in ("file", "id"):
        return True
    if kind != "word":
        return False
    return bool(_HARD_RE.search(_EDGE_PUNCT_RE.sub("", text)))


def _tokens_for_segment(
    seg: md_clean.Segment, S: CleanSettings, message_index: int, role: str
) -> list[Token]:
    base, base_end = md_clean.base_mult(seg.text, seg.kind)
    if seg.mult is not None:
        core = seg.mult
    else:
        core = base
        if seg.kind == "link":
            core = max(core, S.pause_urls)
        elif seg.kind in ("code", "image", "widget"):
            core = max(core, md_clean.COMMA_MULT)
    is_end = seg.sentence_end if seg.sentence_end is not None else base_end

    mod = 1.0  # pause modifiers that apply to every part of the word
    if seg.emphasis and S.emphasis in ("bold", "plain"):
        mod *= S.pause_emphasis
    hard = (not seg.block) and is_hard_word(seg.text, seg.kind)
    if hard:
        mod *= S.pause_hard
    start_mod = S.pause_item_start if seg.bullet else 1.0  # first word of a list item

    tok = Token(
        text=seg.text,
        mult=core * mod * start_mod,
        is_sentence_end=is_end,
        is_code_block=seg.block,
        message_index=message_index,
        role=role,
        kind=seg.kind,
        emphasis=bool(seg.emphasis and S.emphasis == "bold"),
        brk=seg.brk,
        line_kind=seg.line,
        bullet=seg.bullet,
        indent=seg.indent,
        list_item=seg.list_item,
        list_sub=seg.list_sub,
        list_size=seg.list_size,
        list_title=seg.list_title,
    )
    if S.split_long != "on" or seg.kind != "word" or seg.block:
        return [tok]
    chunks = split_long_word(seg.text, S.long_word_len)
    if len(chunks) < 2:
        return [tok]

    out: list[Token] = []
    last = len(chunks) - 1
    for i, c in enumerate(chunks):
        if i == last:
            part = replace(tok, text=c, mult=core * mod, brk=0, bullet="")
        else:
            part = replace(
                tok, text=c, is_sentence_end=False, brk=tok.brk if i == 0 else 0,
                bullet=tok.bullet if i == 0 else "",
                mult=(LONG_WORD_MULT if len(c) > LONG_WORD_THRESHOLD else 1.0) * mod
                * (start_mod if i == 0 else 1.0),
            )
        part.cont = i > 0
        out.append(part)
    return out


def _tokenize_raw(text: str, message_index: int, role: str) -> list[Token]:
    """Original behaviour: whitespace split, fenced code collapsed to one token."""
    tokens: list[Token] = []
    in_code_block = False
    code_lines = 0
    pending = 1  # line break owed to the next token (2 after a blank line)

    def add(tok: Token) -> None:
        nonlocal pending
        tok.brk = max(pending, 1) if tokens else 0
        pending = 1
        tokens.append(tok)

    for line in text.split("\n"):
        stripped = line.strip()
        if _CODE_FENCE_RE.match(stripped):
            if in_code_block:
                add(
                    Token(
                        text=f"[code block, {code_lines} lines]",
                        mult=SENTENCE_END_MULT,
                        is_code_block=True,
                        message_index=message_index,
                        role=role,
                        kind="code",
                    )
                )
                in_code_block = False
                code_lines = 0
            else:
                in_code_block = True
            continue
        if in_code_block:
            code_lines += 1
            continue
        if not stripped:
            pending = 2
            continue
        for n, word in enumerate(stripped.split()):
            tok = _token_for_word(word, message_index, role)
            if n == 0:
                add(tok)
            else:
                tokens.append(tok)

    # Code block never closed (```) before the end of the text: still emit the
    # summary, do not silently drop the content.
    if in_code_block:
        add(
            Token(
                text=f"[code block, {code_lines} lines]",
                mult=SENTENCE_END_MULT,
                is_code_block=True,
                message_index=message_index,
                role=role,
                kind="code",
            )
        )
    return tokens


def tokenize(
    text: str,
    message_index: int = 0,
    role: str = "assistant",
    settings: CleanSettings | None = None,
) -> list[Token]:
    """Tokenize a single block of text (RF2.1, RF2.2).

    With the default / "clean" settings the Markdown noise is removed or
    summarised first (md_clean.clean); in "raw" mode the text is read as-is,
    except that fenced code blocks are collapsed into a single token -- RSVP
    over code is unreadable and is not the use case.
    """
    if not text or not text.strip():
        return []
    S = settings or md_clean.DEFAULTS
    if S.mode == "raw":
        return _tokenize_raw(text, message_index, role)
    out: list[Token] = []
    for seg in md_clean.clean(text, S):
        out.extend(_tokens_for_segment(seg, S, message_index, role))
    return out


def tokenize_messages(messages: list[dict], settings: CleanSettings | None = None) -> list[Token]:
    """Tokenize a list of `{role, content}` messages in the given order (RF1.4).

    Each message is tokenized separately so that the break between messages
    never merges the last word of one with the first word of the next.
    """
    all_tokens: list[Token] = []
    for i, msg in enumerate(messages):
        content = msg.get("content", "")
        role = msg.get("role", "assistant")
        if not isinstance(content, str):
            continue
        all_tokens.extend(tokenize(content, message_index=i, role=role, settings=settings))
    return all_tokens


def token_to_dict(t: Token) -> dict:
    return {
        "text": t.text,
        "mult": t.mult,
        "isSentenceEnd": t.is_sentence_end,
        "isCodeBlock": t.is_code_block,
        "messageIndex": t.message_index,
        "role": t.role,
        "kind": t.kind,
        "emphasis": t.emphasis,
        "breakBefore": t.brk,
        "lineKind": t.line_kind,
        "bullet": t.bullet,
        "indent": t.indent,
        "listItem": t.list_item,
        "listSub": t.list_sub,
        "listSize": t.list_size,
        "listTitle": t.list_title,
        "joinPrev": t.cont,
    }

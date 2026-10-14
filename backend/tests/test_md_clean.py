"""Tests for md_clean / tokenizer.

Fixtures are REAL shapes found in KiroCrew sessions (not invented happy paths):
snake_case identifiers, globs, dates, words with one slash, pseudo-diffs with
/dev/null, an `[OPTIONS: ...]` line, tags quoted in prose, a table with an
escaped pipe... A green suite on invented values proved nothing before.

Run:  python3 -m pytest backend/tests/test_md_clean.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import md_clean  # noqa: E402
import tokenizer  # noqa: E402
from md_clean import CleanSettings  # noqa: E402

BAL = CleanSettings()


def words(text, **overrides):
    S = CleanSettings.from_dict(overrides) if overrides else BAL
    return [t.text for t in tokenizer.tokenize(text, settings=S)]


def toks(text, **overrides):
    S = CleanSettings.from_dict(overrides) if overrides else BAL
    return tokenizer.tokenize(text, settings=S)


# ---------------------------------------------------------------- settings

def test_settings_invalid_values_fall_back_to_defaults():
    S = CleanSettings.from_dict({"urls": "bogus", "table_rows": "6", "pause_tables": float("nan"),
                                 "pause_blocks": 99, "unknown": 1, "emphasis": None})
    assert S.urls == "dom1" and S.table_rows == 6 and S.pause_tables == 2.4
    assert S.pause_blocks == 6.0  # clamped, not rejected
    assert md_clean.CleanSettings.from_dict("nope") == BAL
    assert md_clean.CleanSettings.from_dict(None) == BAL


def test_raw_mode_keeps_old_behaviour():
    out = words("**a** | b\n```py\nx\n```\n", mode="raw")
    assert out == ["**a**", "|", "b", "[code block, 1 lines]"]


# ---------------------------------------------------------------- emphasis

def test_bold_removed_and_flagged():
    ts = toks("The **main point**: here.")
    assert [t.text for t in ts] == ["The", "main", "point:", "here."]
    assert [t.emphasis for t in ts] == [False, True, True, False]
    assert ts[1].mult > 1.0  # emphasis pause


def test_emphasis_plain_and_raw():
    assert [t.emphasis for t in toks("a **b** c", emphasis="plain")] == [False, False, False]
    assert words("a **b** c", emphasis="plain") == ["a", "b", "c"]
    assert words("a **b** c", emphasis="raw") == ["a", "**b**", "c"]


def test_snake_case_globs_and_math_survive():
    text = "use spawn_run and fsdd_agent with --include=*.py and *.tfvars; 2*3*4 and __init__.py"
    out = words(text)
    for w in ("spawn_run", "fsdd_agent", "--include=*.py", "*.tfvars;", "2*3*4", "__init__.py"):
        assert w in out, (w, out)


def test_glob_pair_in_code_line_is_not_italic():
    # real: "*.py --include=*" must not be read as an italic span
    assert words("grep -r --include=*.py --include=* x") == ["grep", "-r", "--include=*.py", "--include=*", "x"]


def test_italic_and_strike():
    assert words("one *text* and _other_ and ~~struck~~.") == ["one", "text", "and", "other", "and", "struck."]


def test_leftover_bold_markers_are_stripped():
    assert words("**There was an outage\nrestore**") == ["There", "was", "an", "outage", "restore"]


# ---------------------------------------------------------------- headings / lists

def test_heading_list_quote_hr():
    text = "## Proposed plan\n- item one\n1. item two\n- [ ] task\n> quoted\n---\nend"
    assert words(text) == ["Proposed", "plan", "item", "one", "item", "two", "task", "quoted", "end"]
    ts = toks(text)
    assert ts[1].mult == 2.4 and ts[1].is_sentence_end  # heading end pause
    assert ts[3].mult >= 1.5  # list item end


def test_versions_and_decimals_are_not_list_markers():
    assert words("1.5 times and v0.7.1") == ["1.5", "times", "and", "v0.7.1"]


def test_heading_raw_keeps_markers():
    assert words("## Title", headings="raw") == ["##", "Title"]
    assert words("- item", lists="raw") == ["-", "item"]


# ---------------------------------------------------------------- code

def test_inline_code_quote_phrase_is_read_not_collapsed():
    assert words('the field `"font color"` changes') == ["the", "field", '"font', 'color"', "changes"]


def test_inline_code_looking_like_code_collapses():
    out = words("call `dataLayer.push({ event: 'x' })` now")
    assert out == ["call", "[code]", "now"]
    assert toks("call `dataLayer.push({ event: 'x' })` now")[1].kind == "code"


def test_inline_code_single_identifier_and_modes():
    assert words("see `spawn_run` and `panel.mjs`.") == ["see", "spawn_run", "and", "panel.mjs."]
    assert words("`git push origin x`", inline="code") == ["[code]"]
    assert words("`dataLayer.push({ a: 1 })`", inline="read")[0] == "dataLayer.push({"


def test_fenced_blocks():
    assert words("```python\na\nb\n```") == ["[code: python, 2 lines]"]
    assert words("```\na\n```") == ["[code, 1 line]"]
    assert words("~~~bash\nls\n~~~") == ["[code: bash, 1 line]"]
    assert words("before\n```js\nx") == ["before", "[code: js, 1 line]"]  # unclosed
    t = toks("```py\nx\n```")[0]
    assert t.is_code_block and t.mult == 2.4


def test_one_line_triple_backtick_is_inline_not_a_fence():
    assert words("use ```x``` here and then more text") == ["use", "x", "here", "and", "then", "more", "text"]


def test_diff_block_summary_real_pseudo_diff():
    diff = (
        "```diff\n--- /dev/null\n+++ /home/user/project/app/ui/panel.mjs\n"
        "@@ -0,0 +1,2 @@\n+a\n+b\n-c\n```"
    )
    assert words(diff) == ["[diff: ui/panel.mjs, +2 \u22121]"]
    assert words(diff, blocks="summary") == ["[code: diff, 6 lines]"]
    two = "```diff\n--- a/x.py\n+++ b/x.py\n+1\n--- a/y.py\n+++ b/y.py\n-2\n```"
    assert words(two) == ["[diff: 2 files, +1 \u22121]"]


# ---------------------------------------------------------------- tables

TABLE = "| Category | Becomes |\n|---|---|\n| Emphasis | important |\n| List | item |"


def test_small_table_is_read_row_by_row():
    out = words(TABLE)
    assert out == ["Category,", "Becomes.", "Emphasis:", "important.", "List:", "item."]
    ts = toks(TABLE)
    assert ts[3].mult == 2.4 and ts[3].is_sentence_end


def test_big_table_collapses_and_modes():
    big = "| a | b | c | d | e |\n|---|---|---|---|---|\n" + "\n".join("| 1 | 2 | 3 | 4 | 5 |" for _ in range(3))
    assert words(big) == ["[table: 3 rows \u00d7 5 cols]"]
    assert words(TABLE, tables="collapse") == ["[table: 2 rows \u00d7 2 cols]"]
    assert len(words(big, tables="read")) > 5


def test_pipe_without_separator_is_not_a_table():
    assert words("a | b | c") == ["a", "b", "c"]  # lone pipes dropped, words kept


def test_table_with_escaped_pipe_and_markup_in_cells():
    t = "| Option | Value |\n|---|---|\n| `a\\|b` | **ok** |"
    assert words(t) == ["Option,", "Value.", "a|b:", "ok."]


# ---------------------------------------------------------------- links, urls, paths, hashes

def test_markdown_link_image_and_bare_url():
    assert words("see [PR #8](https://github.com/o/r/pull/8) ok") == ["see", "PR", "#8", "ok"]
    assert words("see [PR](https://github.com/o/r/pull/8)", links="textdom") == ["see", "PR", "[github.com]"]
    assert words("![diagram](/x.png) end") == ["[image: diagram]", "end"]
    assert words("at https://github.com/example/project.") == ["at", "[link: github.com/example]."]
    assert words("at https://calculator.aws/#/estimate?id=1") == ["at", "[link: calculator.aws]"]


def test_url_modes_and_trailing_punctuation():
    u = "(see https://www.example.com/a/b)."
    assert words(u, urls="dom") == ["(see", "[link: example.com])."]
    assert words(u, urls="hide") == ["(see", ")."]
    assert words(u, urls="full", split_long="off") == ["(see", "https://www.example.com/a/b)."]


def test_url_inside_backticks():
    assert words("`https://api.excalidraw.com/api/v1/mcp`") == ["[link: api.excalidraw.com/api]"]


def test_paths_shortened_but_prose_slashes_are_not():
    p = "/home/user/project/app/ui/panel.mjs"
    assert words(f"edited {p}:42.") == ["edited", "ui/panel.mjs:42."]
    assert words(f"x `{p}`") == ["x", "ui/panel.mjs"]
    assert words(p, paths="base") == ["panel.mjs"]
    assert words(p, paths="full", split_long="off") == [p]
    assert words(p, paths="ph") == ["[file]"]
    # NOT paths:
    keep = ["incident/maintenance", "and/or", "02/09", "0/7", "10/07/2026", "/dev/null", "/compact", "a/b.py"]
    assert words(" ".join(keep)) == keep


def test_relative_and_dir_paths():
    assert words("app/ui/panel.mjs") == ["ui/panel.mjs"]
    assert words("~/.kiro/crew/sessions/") == ["crew/sessions/"]


def test_hashes_and_ids():
    assert words("commit 3cb3747a91bd and 4330023d7d794d84b09ffeb1ebe6b319") == ["commit", "3cb3747", "and", "4330023"]
    assert words("3cb3747a91bd", hashes="ph") == ["[id]"]
    assert words("3cb3747a91bd", hashes="full") == ["3cb3747a91bd"]
    # plain long words / numbers are not hashes
    assert words("defaced 1234567890") == ["defaced", "1234567890"]


def test_arrows_kept_stray_markers_dropped():
    assert words("A -> B | C") == ["A", "\u2192", "B", "C"]


# ---------------------------------------------------------------- html / widgets / options

def test_html_comment_br_widget_and_quoted_tags():
    t = "ok <!-- kirocrew:preview url=\"x\" --> end<br>line\n<mcwidget title=\"Chart\"><div>x | y</div></mcwidget>\nthe <head> tag stays"
    out = words(t)
    assert out == ["ok", "end", "line", "[widget: Chart]", "the", "<head>", "tag", "stays"]
    assert "<!--" in " ".join(words(t, html="keep"))


def test_options_line_is_skipped_by_default():
    t = "[OPTIONS: Do A | Do B]"
    assert words(t) == []
    assert words("Final answer.\n\n" + t) == ["Final", "answer."]
    assert words("Final answer.\n\n" + t, html="keep") == ["Final", "answer."]   # independent of the HTML setting
    # the last real word keeps its own pause: the line vanishing must not change it
    assert toks("Final answer.\n\n" + t)[-1].is_sentence_end is True


def test_options_line_can_be_read_or_kept():
    t = "[OPTIONS: Do A | Do B]"
    assert words(t, options="read") == ["Options:", "Do", "A,", "Do", "B."]
    assert words(t, options="read", lang="pt")[0] == "Opções:"
    assert words(t, options="keep")[0] == "[OPTIONS:"
    assert words(t, mode="raw")[0] == "[OPTIONS:"          # Raw shows the original text
    assert words(t, options="bogus") == []                 # invalid value -> default (skip)


def test_text_that_merely_mentions_options_is_not_skipped():
    # only a line that is nothing but the marker is chrome
    assert words("use [OPTIONS: a | b] at the end") == ["use", "[OPTIONS:", "a", "b]", "at", "the", "end"]


# ---------------------------------------------------------------- i18n / robustness

def test_placeholder_language():
    assert words("```py\nx\n```", lang="pt") == ["[código: py, 1 linha]"]


def test_control_chars_in_input_cannot_forge_markers():
    out = words("a\x01b\x10c \x00 d")
    assert out == ["abc", "d"]


def test_empty_and_whitespace():
    assert words("") == [] and words("  \n \n") == []


def test_never_loses_plain_words():
    text = "A plain text, with commas and accents: café, naïve, façade, über. Done!"
    assert words(text) == text.split()


# ---------- layout hints (context caption keeps the chat's own lines) ----------

def layout(text, **overrides):
    """-> [(word, breakBefore, lineKind, bullet, indent)] for tokens that start a line."""
    return [(t.text, t.brk, t.line_kind, t.bullet, t.indent)
            for t in toks(text, **overrides) if t.brk or t.bullet]


def test_paragraphs_and_lines_keep_their_breaks():
    t = toks("First paragraph.\nSame line right below.\n\nSecond paragraph.")
    starts = {x.text: x.brk for x in t if x.text in ("First", "Same", "Second")}
    assert starts == {"First": 0, "Same": 1, "Second": 2}


def test_heading_gets_paragraph_break_and_kind():
    got = layout("Text before.\n## Proposed plan\nAfter.")
    assert ("Proposed", 2, "h", "", 0) in got
    assert [x for x in got if x[0] == "After."] == [("After.", 1, "", "", 0)]


def test_list_items_have_bullets_numbers_checks_and_indent():
    got = layout("- one\n- two\n   - sub\n3. three\n- [x] done\n- [ ] todo")
    assert got == [
        ("one", 0, "li", "\u2022", 0),  # first token of the message: no break
        ("two", 1, "li", "\u2022", 0),
        ("sub", 1, "li", "\u2022", 1),
        ("three", 1, "li", "3.", 0),
        ("done", 1, "li", "\u2611", 0),
        ("todo", 1, "li", "\u2610", 0),
    ]


def test_table_rows_each_on_their_own_line():
    t = toks("| Cat | Value |\n|---|---|\n| Emphasis | bold |\n| List | bullet |")
    starts = [(x.text, x.line_kind) for x in t if x.brk]
    assert starts == [("Emphasis:", "tr"), ("List:", "tr")]
    assert t[0].line_kind == "th" and t[0].brk == 0


def test_code_block_and_text_after_are_separate_lines():
    t = toks("See:\n```py\nx = 1\n```\nEnd.")
    assert [(x.text, x.brk) for x in t] == [("See:", 0), ("[code: py, 1 line]", 1), ("End.", 1)]


def test_quote_line_kind():
    t = toks("> quoted here\nnormal")
    assert t[0].line_kind == "q" and t[-1].line_kind == "" and t[-1].brk == 1


def test_raw_mode_keeps_lines_too():
    t = toks("a b\n\nc\nd", mode="raw")
    assert [(x.text, x.brk) for x in t] == [("a", 0), ("b", 0), ("c", 2), ("d", 1)]


def test_layout_in_token_dict_and_words_unchanged():
    d = tokenizer.token_to_dict(toks("# T\ntexto")[0])
    assert d["breakBefore"] == 0 and d["lineKind"] == "h" and "bullet" in d and "indent" in d
    assert words("# T\n- a\n- b") == ["T", "a", "b"]


# ---------- list position chip + item lead-in pause ----------

def test_list_position_and_title_from_real_shape():
    text = ("See what we need.\n\n**For each contact source**\n"
            "1. Name of the source and system\n2. How the data is made available\n"
            "3. Technical documentation\n\nAfter the list.")
    t = toks(text)
    items = {x.text: (x.list_item, x.list_size, x.list_title) for x in t if x.bullet}
    assert items == {
        "Name": (1, 3, "For each contact source"),
        "How": (2, 3, "For each contact source"),
        "Technical": (3, 3, "For each contact source"),
    }
    # all words of an item carry the item number; text outside the list carries none
    assert {x.list_item for x in t if x.text in ("system", "data", "documentation")} == {1, 2, 3}
    assert [x.list_item for x in t if x.text in ("See", "After", "list.")] == [0, 0, 0]


def test_nested_items_get_sub_numbers_and_belong_to_parent():
    t = toks("Steps:\n- a\n   - a1\n   - a2\n- b")
    got = {x.text: (x.list_item, x.list_sub, x.list_size) for x in t if x.text in ("a", "a1", "a2", "b")}
    assert got == {"a": (1, 0, 2), "a1": (1, 1, 2), "a2": (1, 2, 2), "b": (2, 0, 2)}


def test_single_item_list_gets_no_chip():
    assert {x.list_item for x in toks("Intro\n- only")} == {0}


def test_long_intro_line_is_shortened_to_last_sentence():
    t = toks("This is a rather long paragraph that explains several things first. For each channel:\n- x1\n- x2")
    assert [x.list_title for x in t if x.text == "x1"] == ["For each channel"]


def test_item_lead_in_pause_applies_only_to_first_word_of_item():
    # list_pause="none" so the item-end comma pause does not mix into the numbers
    t = toks("- one two\n- three four", pause_item_start=2.0, list_pause="none")
    assert [x.mult for x in t] == [2.0, 1.0, 2.0, 1.0]
    t = toks("- one two\n- three four", pause_item_start=1.0, list_pause="none")
    assert [x.mult for x in t] == [1.0, 1.0, 1.0, 1.0]
    assert toks("- one two", list_pause="none")[0].mult == 1.3  # default
    assert toks("text one two", pause_item_start=3.0)[0].mult == 1.0  # not a list item


def test_item_pause_setting_is_clamped_and_never_errors():
    assert CleanSettings.from_dict({"pause_item_start": 99}).pause_item_start == 3.0
    assert CleanSettings.from_dict({"pause_item_start": "x"}).pause_item_start == 1.3


def test_list_fields_in_token_dict():
    d = tokenizer.token_to_dict(toks("Title:\n- a\n- b")[1])
    assert (d["listItem"], d["listSize"], d["listTitle"]) == (1, 2, "Title")


# ---------- long-word splitting ----------

def test_long_words_split_at_their_own_separators_first():
    t = toks("see /home/user/project/app/ui/panel.mjs now", paths="full")
    texts = [x.text for x in t]
    assert texts[0] == "see" and texts[-1] == "now"
    assert texts[1] == "/home/user/project/"  # cut right after a "/", not mid-word
    mid = t[1:-1]
    assert "".join(x.text for x in mid).replace("-", "") == "/home/user/project/app/ui/panel.mjs".replace("-", "")
    assert [x.cont for x in mid] == [False] + [True] * (len(mid) - 1)
    assert all(len(x.text) <= 20 for x in mid)


def test_split_parts_glue_back_to_the_original_word():
    for w in ["getUserNameFromSessionStoreFactory", "my-app-prod-cognito-jwt-authorizer", "Antidisestablishmentarianism"]:
        t = toks(w, long_word_len=12)
        assert len(t) > 1
        glued = "".join(x.text.rstrip("-") if x.text.endswith("-") else x.text for x in t)
        assert glued.replace("-", "") == w.replace("-", ""), (w, [x.text for x in t])
        assert all(len(x.text) <= 12 for x in t), [x.text for x in t]


def test_hard_cut_never_leaves_a_tiny_tail_and_hyphenates():
    parts = tokenizer.split_long_word("abcdefghijklmnopq", 14)  # 17 letters
    assert all(len(p) >= 4 for p in parts) and parts[0].endswith("-")


def test_common_long_prose_words_stay_whole_by_default():
    assert words("notwithstanding accountability, straightforwardly") == [
        "notwithstanding", "accountability,", "straightforwardly"]


def test_split_off_and_raw_mode_keep_words_whole():
    w = "getUserNameFromSessionStoreFactory"
    assert words(w, split_long="off") == [w]
    assert words(w, mode="raw") == [w]


def test_split_pause_goes_to_the_end_of_the_word():
    t = toks("Functionalities/ideas for centralization/versioning of the project.", long_word_len=16)
    ends = [x for x in t if x.is_sentence_end]
    assert [x.text for x in ends] == ["project."]
    first = next(x for x in t if x.text.startswith("Functionalities"))
    assert first.is_sentence_end is False and first.cont is False
    assert tokenizer.token_to_dict(t[1])["joinPrev"] in (True, False)


def test_split_keeps_bullet_and_line_break_on_the_first_part_only():
    t = toks("Intro:\n- environment_configuration_for_production_final\n- b", long_word_len=14)
    firsts = [x for x in t if x.bullet]
    assert [x.text for x in firsts][0].startswith("environment")
    conts = [x for x in t if x.cont]
    assert conts and all(x.brk == 0 and not x.bullet for x in conts)
    assert all(x.list_item == 1 for x in t if x.text.startswith(("environment", "configuration", "for_", "production")) or x.cont)


# ---------- hard tokens (numbers / identifiers) ----------

def test_hard_words_get_extra_pause_only_when_enabled_by_the_setting():
    plain = toks("blue house", pause_hard=1.0)
    assert [x.mult for x in plain] == [1.0, 1.0]
    for w in ["v0.7.1", "a_b", "getUser", "02/09", "R$100", "a.mjs"]:
        assert toks(w, pause_hard=2.0)[0].mult == 2.0, w
        assert toks(w, pause_hard=1.0)[0].mult == 1.0, w
    assert toks("house", pause_hard=2.0)[0].mult == 1.0
    assert toks("End.", pause_hard=2.0)[0].mult == 2.4  # an ordinary sentence end is unchanged


def test_hard_default_is_applied():
    assert toks("v0.7.1")[0].mult == 1.25


def test_placeholders_are_not_doubled_by_the_hard_rule():
    # [link: ...] keeps its own URL pause; the hard rule only touches words / file / id
    link = toks("see https://github.com/example/x", pause_hard=3.0)[-1]
    assert link.kind == "link" and link.mult == 1.5

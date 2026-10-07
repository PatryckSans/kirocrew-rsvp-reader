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
    ts = toks("O **ponto principal**: aqui.")
    assert [t.text for t in ts] == ["O", "ponto", "principal:", "aqui."]
    assert [t.emphasis for t in ts] == [False, True, True, False]
    assert ts[1].mult > 1.0  # emphasis pause


def test_emphasis_plain_and_raw():
    assert [t.emphasis for t in toks("a **b** c", emphasis="plain")] == [False, False, False]
    assert words("a **b** c", emphasis="plain") == ["a", "b", "c"]
    assert words("a **b** c", emphasis="raw") == ["a", "**b**", "c"]


def test_snake_case_globs_and_math_survive():
    text = "use spawn_run e fsdd_agent com --include=*.py e *.tfvars; 2*3*4 e __init__.py"
    out = words(text)
    for w in ("spawn_run", "fsdd_agent", "--include=*.py", "*.tfvars;", "2*3*4", "__init__.py"):
        assert w in out, (w, out)


def test_glob_pair_in_code_line_is_not_italic():
    # real: "*.py --include=*" must not be read as an italic span
    assert words("grep -r --include=*.py --include=* x") == ["grep", "-r", "--include=*.py", "--include=*", "x"]


def test_italic_and_strike():
    assert words("um *texto* e _outro_ e ~~riscado~~.") == ["um", "texto", "e", "outro", "e", "riscado."]


def test_leftover_bold_markers_are_stripped():
    assert words("**Houve uma queda\nrestore**") == ["Houve", "uma", "queda", "restore"]


# ---------------------------------------------------------------- headings / lists

def test_heading_list_quote_hr():
    text = "## Plano proposto\n- item um\n1. item dois\n- [ ] tarefa\n> citado\n---\nfim"
    assert words(text) == ["Plano", "proposto", "item", "um", "item", "dois", "tarefa", "citado", "fim"]
    ts = toks(text)
    assert ts[1].mult == 2.4 and ts[1].is_sentence_end  # heading end pause
    assert ts[3].mult >= 1.5  # list item end


def test_versions_and_decimals_are_not_list_markers():
    assert words("1.5 vezes e v0.7.1") == ["1.5", "vezes", "e", "v0.7.1"]


def test_heading_raw_keeps_markers():
    assert words("## Titulo", headings="raw") == ["##", "Titulo"]
    assert words("- item", lists="raw") == ["-", "item"]


# ---------------------------------------------------------------- code

def test_inline_code_quote_phrase_is_read_not_collapsed():
    assert words('o campo `"cor da fonte"` muda') == ["o", "campo", '"cor', "da", 'fonte"', "muda"]


def test_inline_code_looking_like_code_collapses():
    out = words("chame `dataLayer.push({ event: 'x' })` agora")
    assert out == ["chame", "[code]", "agora"]
    assert toks("chame `dataLayer.push({ event: 'x' })` agora")[1].kind == "code"


def test_inline_code_single_identifier_and_modes():
    assert words("veja `spawn_run` e `panel.mjs`.") == ["veja", "spawn_run", "e", "panel.mjs."]
    assert words("`git push origin x`", inline="code") == ["[code]"]
    assert words("`dataLayer.push({ a: 1 })`", inline="read")[0] == "dataLayer.push({"


def test_fenced_blocks():
    assert words("```python\na\nb\n```") == ["[code: python, 2 lines]"]
    assert words("```\na\n```") == ["[code, 1 line]"]
    assert words("~~~bash\nls\n~~~") == ["[code: bash, 1 line]"]
    assert words("antes\n```js\nx") == ["antes", "[code: js, 1 line]"]  # unclosed
    t = toks("```py\nx\n```")[0]
    assert t.is_code_block and t.mult == 2.4


def test_one_line_triple_backtick_is_inline_not_a_fence():
    assert words("use ```x``` aqui e depois mais texto") == ["use", "x", "aqui", "e", "depois", "mais", "texto"]


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

TABLE = "| Categoria | Vira |\n|---|---|\n| Ênfase | importante |\n| Lista | item |"


def test_small_table_is_read_row_by_row():
    out = words(TABLE)
    assert out == ["Categoria,", "Vira.", "Ênfase:", "importante.", "Lista:", "item."]
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
    t = "| Opção | Valor |\n|---|---|\n| `a\\|b` | **ok** |"
    assert words(t) == ["Opção,", "Valor.", "a|b:", "ok."]


# ---------------------------------------------------------------- links, urls, paths, hashes

def test_markdown_link_image_and_bare_url():
    assert words("veja [PR #8](https://github.com/o/r/pull/8) ok") == ["veja", "PR", "#8", "ok"]
    assert words("veja [PR](https://github.com/o/r/pull/8)", links="textdom") == ["veja", "PR", "[github.com]"]
    assert words("![diagrama](/x.png) fim") == ["[image: diagrama]", "fim"]
    assert words("em https://github.com/example/project.") == ["em", "[link: github.com/example]."]
    assert words("em https://calculator.aws/#/estimate?id=1") == ["em", "[link: calculator.aws]"]


def test_url_modes_and_trailing_punctuation():
    u = "(veja https://www.exemplo.com/a/b)."
    assert words(u, urls="dom") == ["(veja", "[link: exemplo.com])."]
    assert words(u, urls="hide") == ["(veja", ")."]
    assert words(u, urls="full", split_long="off") == ["(veja", "https://www.exemplo.com/a/b)."]


def test_url_inside_backticks():
    assert words("`https://api.excalidraw.com/api/v1/mcp`") == ["[link: api.excalidraw.com/api]"]


def test_paths_shortened_but_prose_slashes_are_not():
    p = "/home/user/project/app/ui/panel.mjs"
    assert words(f"editei {p}:42.") == ["editei", "ui/panel.mjs:42."]
    assert words(f"x `{p}`") == ["x", "ui/panel.mjs"]
    assert words(p, paths="base") == ["panel.mjs"]
    assert words(p, paths="full", split_long="off") == [p]
    assert words(p, paths="ph") == ["[file]"]
    # NOT paths:
    keep = ["incidente/manutenção", "e/ou", "02/09", "0/7", "10/07/2026", "/dev/null", "/compact", "a/b.py"]
    assert words(" ".join(keep)) == keep


def test_relative_and_dir_paths():
    assert words("app/ui/panel.mjs") == ["ui/panel.mjs"]
    assert words("~/.kiro/crew/sessions/") == ["crew/sessions/"]


def test_hashes_and_ids():
    assert words("commit 3cb3747a91bd e 4330023d7d794d84b09ffeb1ebe6b319") == ["commit", "3cb3747", "e", "4330023"]
    assert words("3cb3747a91bd", hashes="ph") == ["[id]"]
    assert words("3cb3747a91bd", hashes="full") == ["3cb3747a91bd"]
    # plain long words / numbers are not hashes
    assert words("defaced 1234567890") == ["defaced", "1234567890"]


def test_arrows_kept_stray_markers_dropped():
    assert words("A -> B | C") == ["A", "\u2192", "B", "C"]


# ---------------------------------------------------------------- html / widgets / options

def test_html_comment_br_widget_and_quoted_tags():
    t = "ok <!-- kirocrew:preview url=\"x\" --> fim<br>linha\n<mcwidget title=\"Grafico\"><div>x | y</div></mcwidget>\na tag <head> fica"
    out = words(t)
    assert out == ["ok", "fim", "linha", "[widget: Grafico]", "a", "tag", "<head>", "fica"]
    assert "<!--" in " ".join(words(t, html="keep"))


def test_options_line_is_skipped_by_default():
    t = "[OPTIONS: Faça A | Faça B]"
    assert words(t) == []
    assert words("Resposta final.\n\n" + t) == ["Resposta", "final."]
    assert words("Resposta final.\n\n" + t, html="keep") == ["Resposta", "final."]   # independent of the HTML setting
    # the last real word keeps its own pause: the line vanishing must not change it
    assert toks("Resposta final.\n\n" + t)[-1].is_sentence_end is True


def test_options_line_can_be_read_or_kept():
    t = "[OPTIONS: Faça A | Faça B]"
    assert words(t, options="read") == ["Options:", "Faça", "A,", "Faça", "B."]
    assert words(t, options="read", lang="pt")[0] == "Opções:"
    assert words(t, options="keep")[0] == "[OPTIONS:"
    assert words(t, mode="raw")[0] == "[OPTIONS:"          # Raw shows the original text
    assert words(t, options="bogus") == []                 # invalid value -> default (skip)


def test_text_that_merely_mentions_options_is_not_skipped():
    # only a line that is nothing but the marker is chrome
    assert words("use [OPTIONS: a | b] no fim") == ["use", "[OPTIONS:", "a", "b]", "no", "fim"]


# ---------------------------------------------------------------- i18n / robustness

def test_placeholder_language():
    assert words("```py\nx\n```", lang="pt") == ["[código: py, 1 linha]"]


def test_control_chars_in_input_cannot_forge_markers():
    out = words("a\x01b\x10c \x00 d")
    assert out == ["abc", "d"]


def test_empty_and_whitespace():
    assert words("") == [] and words("  \n \n") == []


def test_never_loses_plain_words():
    text = "Isso é um texto simples, com vírgulas e acentos: ação, coração. Fim!"
    assert words(text) == text.split()


# ---------- layout hints (context caption keeps the chat's own lines) ----------

def layout(text, **overrides):
    """-> [(word, breakBefore, lineKind, bullet, indent)] for tokens that start a line."""
    return [(t.text, t.brk, t.line_kind, t.bullet, t.indent)
            for t in toks(text, **overrides) if t.brk or t.bullet]


def test_paragraphs_and_lines_keep_their_breaks():
    t = toks("Primeiro paragrafo.\nMesma linha logo abaixo.\n\nSegundo paragrafo.")
    starts = {x.text: x.brk for x in t if x.text in ("Primeiro", "Mesma", "Segundo")}
    assert starts == {"Primeiro": 0, "Mesma": 1, "Segundo": 2}


def test_heading_gets_paragraph_break_and_kind():
    got = layout("Texto antes.\n## Plano proposto\nDepois.")
    assert ("Plano", 2, "h", "", 0) in got
    assert [x for x in got if x[0] == "Depois."] == [("Depois.", 1, "", "", 0)]


def test_list_items_have_bullets_numbers_checks_and_indent():
    got = layout("- um\n- dois\n   - sub\n3. tres\n- [x] feito\n- [ ] falta")
    assert got == [
        ("um", 0, "li", "\u2022", 0),  # first token of the message: no break
        ("dois", 1, "li", "\u2022", 0),
        ("sub", 1, "li", "\u2022", 1),
        ("tres", 1, "li", "3.", 0),
        ("feito", 1, "li", "\u2611", 0),
        ("falta", 1, "li", "\u2610", 0),
    ]


def test_table_rows_each_on_their_own_line():
    t = toks("| Cat | Valor |\n|---|---|\n| Enfase | negrito |\n| Lista | bullet |")
    starts = [(x.text, x.line_kind) for x in t if x.brk]
    assert starts == [("Enfase:", "tr"), ("Lista:", "tr")]
    assert t[0].line_kind == "th" and t[0].brk == 0


def test_code_block_and_text_after_are_separate_lines():
    t = toks("Veja:\n```py\nx = 1\n```\nFim.")
    assert [(x.text, x.brk) for x in t] == [("Veja:", 0), ("[code: py, 1 line]", 1), ("Fim.", 1)]


def test_quote_line_kind():
    t = toks("> citado aqui\nnormal")
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
    text = ("Veja o que precisamos.\n\n**Para cada fonte de contato**\n"
            "1. Nome da fonte e sistema\n2. Como os dados sao disponibilizados\n"
            "3. Documentacao tecnica\n\nDepois da lista.")
    t = toks(text)
    items = {x.text: (x.list_item, x.list_size, x.list_title) for x in t if x.bullet}
    assert items == {
        "Nome": (1, 3, "Para cada fonte de contato"),
        "Como": (2, 3, "Para cada fonte de contato"),
        "Documentacao": (3, 3, "Para cada fonte de contato"),
    }
    # all words of an item carry the item number; text outside the list carries none
    assert {x.list_item for x in t if x.text in ("sistema", "dados", "tecnica")} == {1, 2, 3}
    assert [x.list_item for x in t if x.text in ("Veja", "Depois", "lista.")] == [0, 0, 0]


def test_nested_items_get_sub_numbers_and_belong_to_parent():
    t = toks("Passos:\n- a\n   - a1\n   - a2\n- b")
    got = {x.text: (x.list_item, x.list_sub, x.list_size) for x in t if x.text in ("a", "a1", "a2", "b")}
    assert got == {"a": (1, 0, 2), "a1": (1, 1, 2), "a2": (1, 2, 2), "b": (2, 0, 2)}


def test_single_item_list_gets_no_chip():
    assert {x.list_item for x in toks("Intro\n- unico")} == {0}


def test_long_intro_line_is_shortened_to_last_sentence():
    t = toks("Isso e um paragrafo bem comprido que explica varias coisas antes. Para cada canal:\n- a\n- b")
    assert [x.list_title for x in t if x.text == "a"] == ["Para cada canal"]


def test_item_lead_in_pause_applies_only_to_first_word_of_item():
    # list_pause="none" so the item-end comma pause does not mix into the numbers
    t = toks("- um dois\n- tres quatro", pause_item_start=2.0, list_pause="none")
    assert [x.mult for x in t] == [2.0, 1.0, 2.0, 1.0]
    t = toks("- um dois\n- tres quatro", pause_item_start=1.0, list_pause="none")
    assert [x.mult for x in t] == [1.0, 1.0, 1.0, 1.0]
    assert toks("- um dois", list_pause="none")[0].mult == 1.3  # default
    assert toks("texto um dois", pause_item_start=3.0)[0].mult == 1.0  # not a list item


def test_item_pause_setting_is_clamped_and_never_errors():
    assert CleanSettings.from_dict({"pause_item_start": 99}).pause_item_start == 3.0
    assert CleanSettings.from_dict({"pause_item_start": "x"}).pause_item_start == 1.3


def test_list_fields_in_token_dict():
    d = tokenizer.token_to_dict(toks("Titulo:\n- a\n- b")[1])
    assert (d["listItem"], d["listSize"], d["listTitle"]) == (1, 2, "Titulo")


# ---------- long-word splitting ----------

def test_long_words_split_at_their_own_separators_first():
    t = toks("veja /home/user/project/app/ui/panel.mjs agora", paths="full")
    texts = [x.text for x in t]
    assert texts[0] == "veja" and texts[-1] == "agora"
    assert texts[1] == "/home/user/project/"  # cut right after a "/", not mid-word
    mid = t[1:-1]
    assert "".join(x.text for x in mid).replace("-", "") == "/home/user/project/app/ui/panel.mjs".replace("-", "")
    assert [x.cont for x in mid] == [False] + [True] * (len(mid) - 1)
    assert all(len(x.text) <= 20 for x in mid)


def test_split_parts_glue_back_to_the_original_word():
    for w in ["getUserNameFromSessionStoreFactory", "my-app-prod-cognito-jwt-authorizer", "Anticonstitucionalissimamente"]:
        t = toks(w, long_word_len=12)
        assert len(t) > 1
        glued = "".join(x.text.rstrip("-") if x.text.endswith("-") else x.text for x in t)
        assert glued.replace("-", "") == w.replace("-", ""), (w, [x.text for x in t])
        assert all(len(x.text) <= 12 for x in t), [x.text for x in t]


def test_hard_cut_never_leaves_a_tiny_tail_and_hyphenates():
    parts = tokenizer.split_long_word("abcdefghijklmnopq", 14)  # 17 letters
    assert all(len(p) >= 4 for p in parts) and parts[0].endswith("-")


def test_common_long_prose_words_stay_whole_by_default():
    assert words("preferencialmente relacionamento, predominantemente") == [
        "preferencialmente", "relacionamento,", "predominantemente"]


def test_split_off_and_raw_mode_keep_words_whole():
    w = "getUserNameFromSessionStoreFactory"
    assert words(w, split_long="off") == [w]
    assert words(w, mode="raw") == [w]


def test_split_pause_goes_to_the_end_of_the_word():
    t = toks("Funcionalidades/ideias de centralização/versionamento do projeto.", long_word_len=16)
    ends = [x for x in t if x.is_sentence_end]
    assert [x.text for x in ends] == ["projeto."]
    first = next(x for x in t if x.text.startswith("Funcionalidades"))
    assert first.is_sentence_end is False and first.cont is False
    assert tokenizer.token_to_dict(t[1])["joinPrev"] in (True, False)


def test_split_keeps_bullet_and_line_break_on_the_first_part_only():
    t = toks("Intro:\n- configuracao_de_ambiente_producao_final\n- b", long_word_len=14)
    firsts = [x for x in t if x.bullet]
    assert [x.text for x in firsts][0].startswith("configuracao")
    conts = [x for x in t if x.cont]
    assert conts and all(x.brk == 0 and not x.bullet for x in conts)
    assert all(x.list_item == 1 for x in t if x.text.startswith(("configuracao", "de_", "ambiente", "producao")) or x.cont)


# ---------- hard tokens (numbers / identifiers) ----------

def test_hard_words_get_extra_pause_only_when_enabled_by_the_setting():
    plain = toks("casa verde", pause_hard=1.0)
    assert [x.mult for x in plain] == [1.0, 1.0]
    for w in ["v0.7.1", "a_b", "getUser", "02/09", "R$100", "a.mjs"]:
        assert toks(w, pause_hard=2.0)[0].mult == 2.0, w
        assert toks(w, pause_hard=1.0)[0].mult == 1.0, w
    assert toks("casa", pause_hard=2.0)[0].mult == 1.0
    assert toks("Fim.", pause_hard=2.0)[0].mult == 2.4  # an ordinary sentence end is unchanged


def test_hard_default_is_applied():
    assert toks("v0.7.1")[0].mult == 1.25


def test_placeholders_are_not_doubled_by_the_hard_rule():
    # [link: ...] keeps its own URL pause; the hard rule only touches words / file / id
    link = toks("veja https://github.com/example/x", pause_hard=3.0)[-1]
    assert link.kind == "link" and link.mult == 1.5

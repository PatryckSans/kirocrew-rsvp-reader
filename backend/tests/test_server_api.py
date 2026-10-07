"""API test with a throw-away sessions directory (no real data touched).

aiohttp only exists in the gateway's interpreter, so this runs there:
    <gateway python> backend/tests/test_server_api.py
Under plain pytest it is skipped when aiohttp is missing.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MSGS = [
    {"role": "user", "content": "Faz o relatorio?"},
    {"role": "assistant", "content": "Vou localizar os arquivos."},               # 1 narration
    {"role": "tool", "content": "🔧 ls"},                                         # 2
    {"role": "assistant", "content": "Achei. Agora vou ler."},                    # 3 narration
    {"role": "assistant", "content": "**Resumo:** feito.\n\n- um\n- dois"},       # 4 FINAL of turn 1
    {"role": "user", "content": "Obrigado"},                                      # 5
    {"role": "assistant", "content": "De nada. Veja `spawn_run`."},               # 6 FINAL of turn 2
]


def _write(path: Path, msgs):
    lines = [json.dumps({"_type": "metadata", "title": "T", "updated_at": "2026-10-07T10:00:00-03:00"})]
    for i, m in enumerate(msgs):
        lines.append(json.dumps({**m, "ts": f"2026-10-07T10:0{i}:00+00:00"}))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def run() -> None:
    import server
    import sessions_reader
    from aiohttp.test_utils import TestClient, TestServer

    server.verify_proxy_request = lambda header, *, method, target, body: True
    with tempfile.TemporaryDirectory() as tmp:
        sessions_reader._SESSIONS_DIR_OVERRIDE = Path(tmp)
        f = Path(tmp) / "dashboard_chat-1-1000.jsonl"
        _write(f, MSGS)
        async with TestClient(TestServer(server.create_app())) as c:
            r = await c.get("/api/sessions/dashboard_chat-1-1000/messages", params={"roles": "assistant,user"})
            assert r.status == 200, (r.status, await r.text())
            items = (await r.json())["messages"]
            # most recent first; tool message excluded
            assert [m["index"] for m in items] == [6, 5, 4, 3, 1, 0]
            fin = {m["index"]: m["final"] for m in items}
            assert fin == {6: True, 5: True, 4: True, 3: False, 1: False, 0: True}, fin
            prev = {m["index"]: m["preview"] for m in items}
            assert "**" not in prev[4] and prev[4].startswith("Resumo: feito."), prev[4]
            assert prev[6] == "De nada. Veja spawn_run."

            # `final` does not depend on the roles filter
            r = await c.get("/api/sessions/dashboard_chat-1-1000/messages", params={"roles": "assistant"})
            only = {m["index"]: m["final"] for m in (await r.json())["messages"]}
            assert only == {6: True, 4: True, 3: False, 1: False}, only

            # stamp: stable while idle, changes after an append
            r = await c.get("/api/sessions/dashboard_chat-1-1000/stamp")
            s1 = await r.json()
            r = await c.get("/api/sessions/dashboard_chat-1-1000/stamp")
            assert (await r.json()) == s1
            _write(f, MSGS + [{"role": "assistant", "content": "nova resposta"}])
            r = await c.get("/api/sessions/dashboard_chat-1-1000/stamp")
            s2 = await r.json()
            assert s2["size"] != s1["size"] and s2["mtimeNs"] != s1["mtimeNs"], (s1, s2)
            r = await c.get("/api/sessions/nope/stamp")
            assert r.status == 404

            # panel binding: every shape of X-Session-Key seen in the wild resolves
            for header in ("dashboard:dashboard_chat-1",        # logical slot
                           "dashboard_chat-1",                  # bare slot, no prefix
                           "dashboard:chat-1-1000"):            # real regression: timestamp kept, "dashboard_" lost
                r = await c.get("/api/panel-session", headers={"X-Session-Key": header})
                assert r.status == 200 and (await r.json()) == {"sessionId": "dashboard_chat-1-1000"}, header
            r = await c.get("/api/panel-session", headers={"X-Session-Key": "dashboard:ui"})   # the page's sentinel
            body = await r.json()
            assert r.status == 404 and body["code"] == "no_panel_context" and body["received"] == "dashboard:ui", body
            r = await c.get("/api/panel-session")                                              # no header at all
            assert r.status == 404 and (await r.json())["code"] == "no_panel_context"
            r = await c.get("/api/panel-session", headers={"X-Session-Key": "dashboard:chat-99"})
            body = await r.json()
            assert r.status == 404 and body["code"] == "not_found" and body["received"] == "chat-99", body

            # composer chip status
            r = await c.get("/api/session-status", params={"session_key": "dashboard:chat-1"})
            assert (await r.json())["state"] == "ok"
            r = await c.get("/api/session-status", params={"session_key": "nonexistent-key-xyz"})
            assert (await r.json())["state"] == "none"

            # split + joinPrev reach the client
            r = await c.post("/api/text/tokenize", json={"text": "usar getUserNameFromSessionStoreFactoryX agora", "clean": {"long_word_len": 12}})
            toks = (await r.json())["tokens"]
            assert any(t["joinPrev"] for t in toks) and not toks[0]["joinPrev"], toks
            # invalid new settings degrade to defaults, never an error
            r = await c.post("/api/text/tokenize", json={"text": "a b", "clean": {"long_word_len": "x", "pause_hard": 99, "split_long": "??"}})
            assert r.status == 200
    print("server api ok")


def test_server_api():
    import pytest
    pytest.importorskip("aiohttp")
    asyncio.run(run())


if __name__ == "__main__":
    asyncio.run(run())

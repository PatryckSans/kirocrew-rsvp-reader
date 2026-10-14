"""The REAL backend on 127.0.0.1:8791 over a throw-away sessions dir ($SESS_DIR), HMAC bypassed.
Run with the gateway interpreter (it has aiohttp). Test data only -- never your real sessions."""
import json, sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import server, sessions_reader
from aiohttp import web

server.verify_proxy_request = lambda header, *, method, target, body: True
d = Path(os.environ["SESS_DIR"])
sessions_reader._SESSIONS_DIR_OVERRIDE = d

LONG = " ".join(["word%d" % i for i in range(60)])
FINAL = ("**Summary:** done now.\n\nFor each contact source\n"
         "1. Name of the source and responsible system\n2. How the data is made available\n"
         "3. Technical connection documentation\n\nUse getUserNameFromSessionStoreFactoryXYZ here. " + LONG + "\n\n[OPTIONS: Choose A | Choose B]")
MSGS = [
    {"role": "user", "content": "Can you write the report?"},
    {"role": "assistant", "content": "I will locate the files."},
    {"role": "tool", "content": "tool out"},
    {"role": "assistant", "content": FINAL},
    {"role": "user", "content": "Thanks"},
    {"role": "assistant", "content": "You are welcome, see you later."},
]
def write(name, msgs):
    lines = [json.dumps({"_type": "metadata", "title": name, "updated_at": "2026-10-07T10:00:00-03:00"})]
    for i, m in enumerate(msgs):
        lines.append(json.dumps({**m, "ts": "2026-10-07T13:0%d:00+00:00" % i}))
    (d / f"{name}.jsonl").write_text("\n".join(lines) + "\n")
write("dashboard_chat-7-1000", MSGS)
write("dashboard_chat-8-2000", MSGS[:2])
web.run_app(server.create_app(), host="127.0.0.1", port=8791, print=None)

"""Read KiroCrew chat sessions from the JSONL files.

Kept separate from server.py so it can be tested without HTTP. Source confirmed
by direct reading: ``~/.kiro/crew/sessions/*.jsonl``, one line per message
(`{"role": ..., "content": ..., "ts": ...}`), with the first line of each file
being a metadata record (`{"_type": "metadata", "title": ...}`).

sessionKey -> file resolution uses a GLOB by prefix, not direct concatenation:
a dashboard slot may have multiple files (different timestamps from reopenings),
and the trailing timestamp is not part of the key.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Override for tests; None = resolve via KIROCREW_HOME / default.
_SESSIONS_DIR_OVERRIDE: Path | None = None


def _default_sessions_dir() -> Path:
    home = os.environ.get("KIROCREW_HOME")
    base = Path(home) if home else Path.home() / ".kiro" / "crew"
    return base / "sessions"


def sessions_dir() -> Path:
    return _SESSIONS_DIR_OVERRIDE if _SESSIONS_DIR_OVERRIDE is not None else _default_sessions_dir()


def _safe_key(key: str) -> str:
    """Same sanitization used by KiroCrew (kiro_crew/history.py:_safe_key)."""
    return re.sub(r"[^\w\-.]", "_", key)


@dataclass
class SessionSummary:
    id: str  # file stem, opaque to the frontend
    title: str
    updated_at: str | None
    project: str | None
    path: str


def _read_metadata_line(path: Path) -> dict | None:
    try:
        with open(path, encoding="utf-8") as fh:
            first_line = fh.readline()
        if not first_line.strip():
            return None
        record = json.loads(first_line)
        if record.get("_type") == "metadata":
            return record
        return None
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("failed to read metadata for %s: %s", path, exc)
        return None


def list_sessions() -> list[SessionSummary]:
    """RF1.1 -- list available sessions, ordered by updated_at desc."""
    d = sessions_dir()
    if not d.is_dir():
        return []

    summaries: list[SessionSummary] = []
    for path in d.glob("*.jsonl"):
        if path.name.startswith("."):
            continue
        meta = _read_metadata_line(path)
        title = (meta or {}).get("title") or path.stem
        updated_at = (meta or {}).get("updated_at")
        project = (meta or {}).get("project")
        summaries.append(
            SessionSummary(
                id=path.stem,
                title=title,
                updated_at=updated_at,
                project=project,
                path=str(path),
            )
        )

    summaries.sort(key=lambda s: s.updated_at or "", reverse=True)
    return summaries


def resolve_session_key(session_key: str) -> Path | None:
    """Resolve a sessionKey (from the composer chip) to the most recent JSONL
    file of that slot.

    Step 1: try the exact sanitized name (covers channel sessions, whose file
    name is usually 1:1 with the key, without a loose timestamp).
    Step 2: if not found, glob by prefix and pick the file with the highest
    timestamp/mtime -- covers dashboard sessions, where the real file name
    carries a timestamp that is not in the key.
    Returns None if nothing is found (the caller should degrade to RF1.1).
    """
    d = sessions_dir()
    if not d.is_dir():
        return None

    stem = _safe_key(session_key)

    exact = d / f"{stem}.jsonl"
    if exact.is_file():
        return exact

    candidates = sorted(d.glob(f"{stem}-*.jsonl"), key=lambda p: p.stat().st_mtime)
    if candidates:
        return candidates[-1]

    return None


def resolve_session_id_or_key(id_or_key: str) -> str | None:
    """Resolve a session identifier coming from ANY frontend source to the real
    `session_id` (the JSONL file stem).

    THREE different sources reach here with different formats. The gateway's
    `dashboard:` WIRE prefix (stripped by the caller, _panel_slot_from_request) is
    a different thing from the `dashboard_` prefix that is part of the session
    file's stem, so what arrives can lack `dashboard_` while already carrying the
    trailing timestamp (`chat-60-1789688686` for `dashboard_chat-60-1789688686.jsonl`):

    - the page dropdown (RF1.1) sends the opaque `id` from list_sessions(),
      which is ALREADY the exact file stem (`dashboard_<slot>-<timestamp>`);
    - the composer chip (RF6) sends `session.sessionKey`, the LOGICAL key of the
      slot WITHOUT the timestamp (e.g. `dashboard_chat-60`) -- resolved via
      glob-by-prefix in resolve_session_key();
    - the panel tab (RF-panel) sends a slot already carrying the timestamp but
      STRIPPED of the `dashboard_` filename prefix (e.g. `chat-60-1789688686`)
      -- neither the dropdown's exact-id case nor the chip's prefix-glob case
      matches this directly, so a `dashboard_` reconstruction attempt is tried
      first for any id/key that does not already start with it.

    Order: exact id -> exact id with `dashboard_` reconstructed -> glob-by-prefix
    (bare) -> glob-by-prefix (with `dashboard_` reconstructed). Each step is a
    cheap stat/glob; the first hit wins.
    """
    d = sessions_dir()
    if not d.is_dir():
        return None

    candidates_exact = [id_or_key]
    if not id_or_key.startswith("dashboard_"):
        candidates_exact.append(f"dashboard_{id_or_key}")

    for candidate in candidates_exact:
        exact = d / f"{candidate}.jsonl"
        if exact.is_file():
            return candidate

    candidates_prefix = [id_or_key]
    if not id_or_key.startswith("dashboard_"):
        candidates_prefix.append(f"dashboard_{id_or_key}")

    for candidate in candidates_prefix:
        resolved = resolve_session_key(candidate)
        if resolved is not None:
            return resolved.stem

    return None


def read_session_messages(session_id: str, roles: set[str] | None = None) -> list[dict]:
    """RF1.2/RF1.3 -- read the JSONL by session id (opaque stem, from
    list_sessions), discard the metadata line, filter by role, return in file
    order.

    Each message carries an ABSOLUTE ``index``, counted over all valid messages
    of the file BEFORE the role filter. This is deliberate: the index is used as
    a stable identifier in the URL (/messages/{index}/tokens), so it must not
    shift when the caller changes the role filter between two calls.

    Lines that fail to parse are logged and skipped -- they do not break the list.
    """
    d = sessions_dir()
    path = d / f"{session_id}.jsonl"
    if not path.is_file():
        return []

    messages: list[dict] = []
    absolute_index = 0
    with open(path, encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                logger.warning("skip malformed line %d in %s: %s", line_no, path, exc)
                continue
            if record.get("_type") == "metadata":
                continue
            content = record.get("content")
            if not isinstance(content, str):
                continue
            # Index assigned BEFORE the role filter, so it stays stable.
            current_index = absolute_index
            absolute_index += 1
            role = record.get("role")
            if roles is not None and role not in roles:
                continue
            messages.append(
                {"index": current_index, "role": role, "content": content, "ts": record.get("ts")}
            )

    return messages


def session_stamp(session_id: str) -> dict | None:
    """`{mtimeNs, size}` of the session file -- changes whenever messages are
    appended. None when the file does not exist."""
    try:
        st = (sessions_dir() / f"{session_id}.jsonl").stat()
    except OSError:
        return None
    return {"mtimeNs": st.st_mtime_ns, "size": st.st_size}


def read_single_message(session_id: str, index: int) -> dict | None:
    """Read ONE message by its absolute index (the same one exposed by
    read_session_messages). Returns None if the index does not exist."""
    for msg in read_session_messages(session_id, roles=None):
        if msg["index"] == index:
            return msg
    return None


def read_messages_by_session_key(session_key: str, roles: set[str] | None = None) -> tuple[str, list[dict]] | None:
    """Combine resolve_session_key + read_session_messages for the chip path
    (RF6). Returns (session_id, messages) or None if it does not resolve."""
    path = resolve_session_key(session_key)
    if path is None:
        return None
    session_id = path.stem
    return session_id, read_session_messages(session_id, roles)

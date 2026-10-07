"""RSVP Reader backend -- its own aiohttp process, reverse-proxied by the
KiroCrew gateway at /apps/rsvp-reader/api/* (confirmed in app.json).

Proxy authentication: `kirocrew-client` (documented at kiro.dev/docs/crew/apps/sdk/)
does NOT exist on PyPI (confirmed: pypi.org/pypi/kirocrew-client/json -> 404,
`pip index versions kirocrew-client` -> No matching distribution). Instead of
depending on a nonexistent package, we import directly from
`kiro_crew.apps.proxy_auth` -- the internal module the gateway itself uses to
SIGN the request, already present in the same Python interpreter that runs this
backend (it is the main KiroCrew package, not something we need to install).
Same pattern the builtin apps (e.g. md-notebook) use.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from aiohttp import web

import md_clean
import sessions_reader
import tokenizer

try:
    from kiro_crew.apps.proxy_auth import raw_request_target, verify_proxy_request
except ImportError:  # pragma: no cover -- only absent outside the real KiroCrew environment
    raw_request_target = None  # type: ignore[assignment]
    verify_proxy_request = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

PORT = int(os.environ.get("PORT", 8971))

VALID_ROLES = {"assistant", "user", "tool"}


# --- Self-shutdown watchdog --------------------------------------------------
# Guards against the backend being left ORPHANED AND STUCK in a permanent 502
# after uninstall/install/enable/disable cycles. Root cause confirmed by reading
# the gateway's real code (kiro_crew/apps/backend.py and routes.py): `kirocrew
# app install` starts this backend unconditionally EVEN while the app is still
# disabled; when the gateway detects this, it undoes the health promotion
# (healthy=False) but NEVER kills the process -- and start_app_backend() has a
# short-circuit that decides purely on liveness (`proc.poll() is None`), never on
# `healthy`, so it reuses this process forever on any subsequent Enable. The
# gateway offers no "force respawn" parameter nor HTTP endpoint that guarantees
# killing a process it no longer tracks itself -- the only viable fix is for this
# process to self-destruct when it detects, in a STABLE (not transient) way, that
# the app is disabled. That makes `proc.poll()` stop being None, which breaks the
# short-circuit at the root: the next Enable no longer finds a live process to
# reuse and spawns clean.
#
# installed.json sits at the root of the app directory, one level above
# backend/server.py (schema confirmed by reading the real file on disk:
# {"name", "enabled": bool, ...}). Path derived from __file__, no env var, so it
# works in any install (dev, registry, dev-mode symlink).
_INSTALLED_JSON = Path(__file__).resolve().parent.parent / "installed.json"

_WATCHDOG_POLL_SECS = 3.0          # poll frequency
_WATCHDOG_DISABLED_STRIKES = 3     # consecutive enabled=false reads before acting (~9s)
_WATCHDOG_HEALTH_GRACE_SECS = 2.0  # /health responds 503 for this long before the exit

# Read by api_health: when True, /health degrades to 503 before the exit --
# shortens the window in which the gateway still routes to a process about to
# vanish, instead of hitting a dead socket.
_shutting_down = False


def _read_enabled() -> bool | None:
    """True/False per installed.json; None if it could not be determined.

    None is FAIL-OPEN: the caller must never shut the process down based on a
    None -- only a STABLE False (several consecutive reads) is a valid reason,
    because a single False may be a moment of concurrent write by the gateway
    during a legitimate Enable (installed.json is not written atomically from
    this reader's point of view).
    """
    try:
        with _INSTALLED_JSON.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        # Transient I/O or partial/malformed JSON (concurrent write) --
        # uncertain, never a reason to act.
        return None
    enabled = data.get("enabled")
    if not isinstance(enabled, bool):
        return None
    return enabled


async def _self_shutdown_watchdog() -> None:
    """Shut the process down if the app is STABLY disabled.

    Never kills on an isolated read -- requires _WATCHDOG_DISABLED_STRIKES
    consecutive False reads (~9s), which absorbs the gateway's Enable write
    window. Any uncertain read (None) resets the counter.
    """
    global _shutting_down
    strikes = 0
    while True:
        try:
            await asyncio.sleep(_WATCHDOG_POLL_SECS)
            enabled = _read_enabled()
            if enabled is False:
                strikes += 1
            else:
                # True or None (uncertain) -- does not count as a strike.
                strikes = 0

            if strikes >= _WATCHDOG_DISABLED_STRIKES:
                logger.warning(
                    "watchdog: app disabled in %s for %d consecutive cycles; self-shutting down",
                    _INSTALLED_JSON, strikes,
                )
                _shutting_down = True  # /health starts responding 503
                await asyncio.sleep(_WATCHDOG_HEALTH_GRACE_SECS)

                # RECONFIRM before dying. Closes the race window where the user
                # clicks Enable exactly during the grace: in that case the Enable
                # has already reused this process (start_app_backend's live-process
                # short-circuit), so dying now would leave the app stuck with
                # nothing to respawn. If the state flipped, abort the shutdown and
                # go back to announcing healthy -- the gateway's health loop, which
                # is still running, will promote on its next attempt.
                if _read_enabled() is not False:
                    logger.warning(
                        "watchdog: enabled changed during the grace; aborting the shutdown"
                    )
                    _shutting_down = False
                    strikes = 0
                    continue

                # os._exit, not sys.exit: inside an asyncio task, SystemExit would
                # be caught by the loop and would NOT terminate the process -- and
                # it is precisely the process staying alive that causes the bug.
                logger.warning("watchdog: os._exit(0) now")
                os._exit(0)
        except asyncio.CancelledError:
            # Normal aiohttp shutdown (app.on_cleanup) -- exit without drama.
            raise
        except Exception:  # noqa: BLE001 -- the watchdog must never take down the backend
            logger.exception("watchdog: unexpected error; ignoring and continuing")
            strikes = 0


#: Upper bound for the `clean` query parameter (URL-encoded JSON settings).
_MAX_CLEAN_PARAM = 4096


def _parse_clean(request: web.Request) -> md_clean.CleanSettings:
    """Text-cleanup settings from `?clean=<json>`. Missing, oversized, malformed
    or partly invalid input never errors: it degrades to the defaults field by
    field (CleanSettings.from_dict)."""
    raw = request.query.get("clean")
    if not raw or len(raw) > _MAX_CLEAN_PARAM:
        return md_clean.DEFAULTS
    try:
        return md_clean.CleanSettings.from_dict(json.loads(raw))
    except (ValueError, TypeError):
        return md_clean.DEFAULTS


def _parse_roles(request: web.Request) -> set[str]:
    raw = request.query.get("roles", "assistant")
    roles = {r.strip() for r in raw.split(",") if r.strip()}
    roles &= VALID_ROLES
    return roles or {"assistant"}


@web.middleware
async def proxy_auth_middleware(request: web.Request, handler):
    """Verify the gateway's HMAC signature on every route except /health.

    Follows exactly the real pattern used by the builtin apps (confirmed by
    reading kiro_crew/apps/builtins/md_notebook/server.py): `X-KiroCrew-Proxy`
    header, verified against the RAW request-target via `raw_request_target(request)`
    -- request.path/query_string are decoded by aiohttp and diverge from the
    signed bytes when the query has a percent-encodable character.
    """
    if request.path == "/health":
        return await handler(request)

    if verify_proxy_request is None or raw_request_target is None:
        # Import failed -- fail closed, never open the route.
        logger.error("kiro_crew.apps.proxy_auth unavailable; refusing request to %s", request.path)
        return web.json_response(
            {"error": "backend misconfigured: proxy_auth unavailable", "code": "missing_dependency"},
            status=500,
        )

    body = await request.read() if request.can_read_body else b""
    if not verify_proxy_request(
        request.headers.get("X-KiroCrew-Proxy", ""),
        method=request.method,
        target=raw_request_target(request),
        body=body,
    ):
        logger.warning("proxy auth failed for %s %s", request.method, request.path)
        return web.json_response(
            {"error": "invalid or missing proxy signature", "code": "invalid_proxy_signature"},
            status=401,
        )
    return await handler(request)


async def api_health(request: web.Request) -> web.Response:
    """Gateway health check -- exempt from the HMAC signature (canonical pattern,
    confirmed by reading the 5 builtin backends: the gateway probe hits it
    directly, without a signature).

    THIS HANDLER IS THE CENTRAL FIX for the "no reachable backend" bug.
    Explanation (confirmed by reading kiro_crew/apps/backend.py):

    The gateway runs `_health_check_loop` ONCE after the spawn, with 15 attempts
    spaced 2s apart. On each attempt: if `/health` responds < 400, it calls
    `_set_backend_health(healthy=True)`, which READS `enabled` from installed.json
    -- and if it is False, it undoes the promotion and the loop does `return None`,
    GIVING UP PERMANENTLY (it does not spend the remaining attempts). Because
    `install` starts the backend unconditionally while the app is still disabled, a
    backend that responds 200 IMMEDIATELY burns its only chance at that instant,
    and no subsequent Enable restarts this loop (start_app_backend short-circuits
    on a live process). Result: permanent 502.

    The way out is to not announce healthy before the app is enabled: by
    responding 503 while `enabled` is False, `_health_probe` returns False, the
    loop does NOT give up and keeps trying -- and when the user clicks Enable, the
    next attempt finds enabled=True and promotes correctly.

    IMPORTANT: 503 (>= 400) and not 204/3xx -- `_health_probe` treats any status
    < 400 as "alive", so a 204 would have no effect at all.

    FAIL-OPEN when the state is indeterminate (None): a transient read error must
    never make a legitimately enabled app look dead and get demoted by the liveness
    watch.
    """
    if _shutting_down:
        # The watchdog has already decided to self-destruct -- degrade before the
        # os._exit so the gateway stops routing here instead of hitting a dead
        # socket.
        return web.json_response({"status": "shutting_down"}, status=503)

    if _read_enabled() is False:
        # Explicitly disabled: do NOT announce healthy, so we don't burn the
        # gateway health loop's only promotion. None (indeterminate) falls through
        # to the 200 below, on purpose.
        return web.json_response({"status": "app_disabled"}, status=503)

    return web.json_response({"status": "ok"})


async def api_sessions(request: web.Request) -> web.Response:
    """GET /api/sessions -- RF1.1."""
    sessions = sessions_reader.list_sessions()
    return web.json_response(
        [
            {
                "id": s.id,
                "title": s.title,
                "updatedAt": s.updated_at,
                "project": s.project,
            }
            for s in sessions
        ]
    )


async def api_session_text(request: web.Request) -> web.Response:
    """GET /api/sessions/{id}/text?roles=assistant,user -- RF1.2, RF1.3, RF2.1.

    {id} accepts both the dropdown's opaque id and a sessionKey from the composer
    chip -- see sessions_reader.resolve_session_id_or_key.
    """
    session_id = sessions_reader.resolve_session_id_or_key(request.match_info["id"])
    if session_id is None:
        return web.json_response({"error": "session not found", "code": "not_found"}, status=404)
    roles = _parse_roles(request)
    messages = sessions_reader.read_session_messages(session_id, roles=roles)
    if not messages:
        return web.json_response({"error": "session not found or empty", "code": "not_found"}, status=404)
    tokens = tokenizer.tokenize_messages(messages, settings=_parse_clean(request))
    return web.json_response(
        {
            "sessionId": session_id,
            "tokens": [tokenizer.token_to_dict(t) for t in tokens],
        }
    )


async def api_text_tokenize(request: web.Request) -> web.Response:
    """POST /api/text/tokenize {text, clean?} -- RF1.5, manual input (also the Settings preview)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body", "code": "bad_request"}, status=400)

    text = body.get("text", "")
    if not isinstance(text, str) or not text.strip():
        return web.json_response({"error": "text is required", "code": "bad_request"}, status=400)

    settings = md_clean.CleanSettings.from_dict(body.get("clean"))
    tokens = tokenizer.tokenize(text, settings=settings)
    return web.json_response({"tokens": [tokenizer.token_to_dict(t) for t in tokens]})


def _preview(text: str, limit: int = 90) -> str:
    """Selector label: the first words of the message as the reader will SHOW
    them (Markdown cleaned: "important", not "**important**"), shortened."""
    words: list[str] = []
    try:
        words = [t.text for t in tokenizer.tokenize(text[:1200])[:24]]
    except Exception:  # noqa: BLE001 -- a label must never break the message list
        logger.exception("preview cleanup failed; using the raw text")
    flat = " ".join(words) if words else " ".join(text.split())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


def final_assistant_indices(messages: list[dict]) -> set[int]:
    """Absolute indices of the assistant message that CLOSES each turn (the last
    assistant message before the next user message). The ones before it are
    mostly narration between tool calls ("Vou localizar...")."""
    finals: set[int] = set()
    seen_later = False
    for m in reversed(messages):
        role = m.get("role")
        if role == "user":
            seen_later = False
        elif role == "assistant":
            if not seen_later:
                finals.add(m["index"])
            seen_later = True
    return finals


async def api_session_messages(request: web.Request) -> web.Response:
    """GET /api/sessions/{id}/messages?roles=assistant,user

    Lists the session's messages separately (input and output), from the MOST
    RECENT to the oldest -- the order the reader offers them in. Each item's
    `index` is absolute and stable (see sessions_reader.read_session_messages).

    {id} accepts both the dropdown's opaque id and a sessionKey from the composer
    chip (see sessions_reader.resolve_session_id_or_key) -- without this
    resolution, the chip navigated with the slot's sessionKey (no timestamp) and
    the route responded 404 even with the session existing.
    """
    session_id = sessions_reader.resolve_session_id_or_key(request.match_info["id"])
    if session_id is None:
        return web.json_response({"error": "session not found", "code": "not_found"}, status=404)
    roles = _parse_roles(request)
    # Read every role: whether an assistant message is the final one of its turn
    # depends on the user messages around it, even when the caller filters them out.
    everything = sessions_reader.read_session_messages(session_id, roles=None)
    finals = final_assistant_indices(everything)
    messages = [m for m in everything if m.get("role") in roles]
    if not messages:
        return web.json_response({"error": "session not found or empty", "code": "not_found"}, status=404)

    items = [
        {
            "index": m["index"],
            "role": m["role"],
            "preview": _preview(m["content"]),
            "wordCount": len(m["content"].split()),
            "ts": m.get("ts"),
            # user messages and the closing assistant message of a turn are "final"
            "final": m["role"] != "assistant" or m["index"] in finals,
        }
        for m in messages
    ]
    items.reverse()  # most recent first
    return web.json_response({"sessionId": session_id, "messages": items})


async def api_session_stamp(request: web.Request) -> web.Response:
    """GET /api/sessions/{id}/stamp -- cheap change detector (one stat() call).

    The reader polls this to learn that the conversation grew, and only then
    re-lists the messages."""
    session_id = sessions_reader.resolve_session_id_or_key(request.match_info["id"])
    if session_id is None:
        return web.json_response({"error": "session not found", "code": "not_found"}, status=404)
    stamp = sessions_reader.session_stamp(session_id)
    if stamp is None:
        return web.json_response({"error": "session not found", "code": "not_found"}, status=404)
    return web.json_response({"sessionId": session_id, **stamp})


async def api_message_tokens(request: web.Request) -> web.Response:
    """GET /api/sessions/{id}/messages/{index}/tokens -- tokens of ONE message.

    {id} accepts both the opaque id and a sessionKey -- same resolution as the
    /messages route, so the chip's navigation (which only knows the sessionKey)
    works just like the dropdown's.
    """
    session_id = sessions_reader.resolve_session_id_or_key(request.match_info["id"])
    if session_id is None:
        return web.json_response({"error": "session not found", "code": "not_found"}, status=404)
    raw_index = request.match_info["index"]
    try:
        index = int(raw_index)
    except ValueError:
        return web.json_response({"error": "index must be an integer", "code": "bad_request"}, status=400)

    message = sessions_reader.read_single_message(session_id, index)
    if message is None:
        return web.json_response({"error": "message not found", "code": "not_found"}, status=404)

    tokens = tokenizer.tokenize(
        message["content"],
        message_index=index,
        role=message.get("role") or "assistant",
        settings=_parse_clean(request),
    )
    return web.json_response(
        {
            "sessionId": session_id,
            "index": index,
            "role": message.get("role"),
            "tokens": [tokenizer.token_to_dict(t) for t in tokens],
        }
    )


async def api_session_status(request: web.Request) -> web.Response:
    """GET /api/session-status?session_key=... -- RF6.6, the chip's statusPath.

    The dashboard attaches session_key alone; the app never picks the origin.
    """
    session_key = request.query.get("session_key", "")
    if not session_key:
        return web.json_response({"state": "none", "tooltip": "No active session"})

    resolved = sessions_reader.read_messages_by_session_key(session_key, roles={"assistant"})
    if resolved is None:
        return web.json_response({"state": "none", "tooltip": "Session not found"})

    _session_id, messages = resolved
    word_count = sum(len(m["content"].split()) for m in messages)
    if word_count == 0:
        return web.json_response({"state": "none", "tooltip": "No assistant outputs yet"})

    return web.json_response(
        {"state": "ok", "tooltip": f"~{word_count} assistant words in this conversation"}
    )


def _panel_slot_from_request(request: web.Request) -> str | None:
    """The chat slot the panel tab is bound to, from the gateway's own
    `X-Session-Key` header.

    The dashboard sends `X-Session-Key: dashboard:<slot>` on every useAppApi()
    request made from a panelTabs entry (confirmed in its bundle). `<slot>` is the
    key `usePanelTabs(slot)` scopes that whole side panel with -- the same logical
    key the composer chip's `session.sessionKey` carries -- so
    `sessions_reader.resolve_session_id_or_key` can turn it into a real session.

    The `dashboard:` prefix is stripped when present and the bare slot is accepted
    too (the prefix of other surfaces is not documented). Not a chat slot, hence
    None: an empty header (a raw curl) and the page's own sentinel (`dashboard:ui`).
    """
    header = request.headers.get("X-Session-Key", "")
    prefix = "dashboard:"
    slot = header[len(prefix):] if header.startswith(prefix) else header
    if not slot or slot == "ui":
        return None
    return slot


async def api_panel_session(request: web.Request) -> web.Response:
    """GET /api/panel-session -- the session the panel tab this request came from
    is bound to (see _panel_slot_from_request). The panel has no session picker:
    the host already scopes it to one chat.

    The 404 bodies say what was received; the panel shows them when binding fails.
    """
    slot = _panel_slot_from_request(request)
    if slot is None:
        return web.json_response(
            {"error": "no panel session context", "code": "no_panel_context",
             "received": request.headers.get("X-Session-Key", "")},
            status=404,
        )
    session_id = sessions_reader.resolve_session_id_or_key(slot)
    logger.debug("panel-session: slot=%r -> session_id=%r", slot, session_id)
    if session_id is None:
        return web.json_response({"error": "session not found", "code": "not_found", "received": slot}, status=404)
    return web.json_response({"sessionId": session_id})


def create_app() -> web.Application:
    app = web.Application(middlewares=[proxy_auth_middleware])
    app.router.add_get("/health", api_health)
    app.router.add_get("/api/health", api_health)
    app.router.add_get("/api/sessions", api_sessions)
    app.router.add_get("/api/panel-session", api_panel_session)
    app.router.add_get("/api/sessions/{id}/text", api_session_text)
    app.router.add_get("/api/sessions/{id}/messages", api_session_messages)
    app.router.add_get("/api/sessions/{id}/stamp", api_session_stamp)
    app.router.add_get("/api/sessions/{id}/messages/{index}/tokens", api_message_tokens)
    app.router.add_post("/api/text/tokenize", api_text_tokenize)
    app.router.add_get("/api/session-status", api_session_status)

    async def _start_watchdog(app: web.Application) -> None:
        app["watchdog"] = asyncio.create_task(_self_shutdown_watchdog())

    async def _stop_watchdog(app: web.Application) -> None:
        task = app.get("watchdog")
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app.on_startup.append(_start_watchdog)
    app.on_cleanup.append(_stop_watchdog)
    return app


def main() -> int:
    app = create_app()
    logging.basicConfig(level=logging.INFO)
    logger.info("RSVP Reader backend starting on 127.0.0.1:%d", PORT)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

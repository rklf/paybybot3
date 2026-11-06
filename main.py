"""Vercel entrypoint: the hosted paybybot web interface (see paybybot3/web.py)."""

import os

os.environ.setdefault("PAYBYBOT_HOSTED", "1")

if os.environ.get("SENTRY_DSN"):
    # Server errors and slow requests to Sentry (project paybybot-api). No personal data: no IP, cookies, headers
    # or request bodies (passwords, plates and cards never leave the server).
    import sentry_sdk

    def _scrub(event, hint):
        event["user"] = {"ip_address": None}  # explicitly empty: Sentry does not take the connection's IP
        request = event.get("request") or {}
        for key in ("cookies", "headers", "data", "query_string", "env"):
            request.pop(key, None)
        # Nor any function's variables in a crash's frames (a card being added could be among them).
        for exc in (event.get("exception") or {}).get("values") or []:
            for frame in (exc.get("stacktrace") or {}).get("frames") or []:
                frame.pop("vars", None)
        return event

    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    # 503 is PayByPhone busy or unreachable (and 422 its refusals): passing, not PayByBot's bugs, never reported.
    failed = {*range(500, 503), *range(504, 600)}
    sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], environment="production", send_default_pii=False,
                    traces_sample_rate=0.3, before_send=_scrub, before_send_transaction=_scrub,
                    integrations=[StarletteIntegration(failed_request_status_codes=failed),
                                  FastApiIntegration(failed_request_status_codes=failed)])

from paybybot3.web import app  # noqa: E402,F401

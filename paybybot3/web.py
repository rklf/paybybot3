"""Web interface for paybybot3.

Runs a small HTTP server that wraps :class:`paybybot3.bot.Bot` and serves the
single-page app built from ``web/`` (copied into ``static/``).

Two modes:
- local (``paybybot3 web``): sessions live in this process' memory, with the
  password, so the weekly renewal can run in the background;
- hosted (``PAYBYBOT_HOSTED=1``, e.g. on Vercel): no server state; the
  PayByPhone tokens are kept in an encrypted cookie (key from
  ``PAYBYBOT_SECRET``) and the password is never stored. Weekly renewals are
  kept in Supabase (``PAYBYBOT_SUPABASE_URL`` / ``_KEY`` / ``PAYBYBOT_DB_TOKEN``)
  with an encrypted refresh token, and processed by ``/api/cron/renew``,
  called every few minutes by a scheduler.
"""

import base64
from concurrent.futures import ThreadPoolExecutor
import contextvars
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
import calendar
from datetime import date, datetime, time as dtime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo
from pathlib import Path

import requests
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from typing import Annotated

from . import schedule
from .bot import Bot, bank_asks

log = logging.getLogger("paybybot3.web")

STATIC_DIR = Path(__file__).parent / "static"
COOKIE = "pbb_session"
HOSTED = os.environ.get("PAYBYBOT_HOSTED") == "1"
SESSION_IDLE = 12 * 3600  # an unused login cookie expires after 12 hours...
SESSION_MAX = 24 * 3600  # ...and any login after 24 hours
REMEMBER = 30 * 24 * 3600  # "Se souvenir de moi": 30 days
LOGIN_LIMITS = (("ip", 50), ("user", 20))  # attempts per 15 minutes, per device and per account
PARIS = ZoneInfo("Europe/Paris")
MAIL_FROM = os.environ.get("PAYBYBOT_MAIL_FROM", "PayByBot <contact@paybybot.fr>")
MAIL_REPLY_TO = os.environ.get("PAYBYBOT_MAIL_REPLY_TO", "contact@paybybot.fr")
APP_URL = os.environ.get("PAYBYBOT_URL", "https://paybybot.vercel.app")
RELOGIN = ("Votre connexion PayByPhone a expiré : reconnectez-vous sur PayByBot pour relancer "
           "le renouvellement automatique.")

app = FastAPI(title="paybybot3", docs_url=None, redoc_url=None)


# --------------------------------------------------------------------------
# Demo bot: lets anyone try the interface without a PayByPhone account
# --------------------------------------------------------------------------


class DemoBot:
    """Same public surface as Bot, backed by in-memory fake data."""

    def __init__(self):
        self.sessions = []

    def get_vehicles(self):
        return [
            {"vehicleId": "v1", "licensePlate": "AB123CD", "country": "FR", "type": "Car", "archived": False},
            # A second car without the resident rate: the demo shows a car with no ticket to programme.
            {"vehicleId": "v2", "licensePlate": "GH456JK", "country": "FR", "type": "Car", "archived": False},
            {"vehicleId": "v3", "licensePlate": "LM789NP", "country": "FR", "type": "Motorcycle", "archived": False},
        ]

    def get_payment_accounts(self):
        return {
            "paymentCards": [
                {"cardType": "Visa", "maskedCardNumber": "************4242", "paymentAccountId": "demo-card",
                 "paymentScope": "", "expiryMonth": 4, "expiryYear": 2028},
            ],
            "mno": [],
            "paypalAccounts": [],
        }

    def get_parking_sessions(self, licensePlate=None, locationId=None):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        self.sessions = [s for s in self.sessions if s["expireTime"] > now]
        return [
            s for s in self.sessions
            if (licensePlate is None or s["vehicle"]["licensePlate"] == licensePlate)
            and (locationId is None or s["locationId"] == locationId)
        ]

    def _get_parking_sessions(self, periodType="CURRENT", limit=50):
        return self.get_parking_sessions()

    def get_past_sessions(self, limit=20):
        # Two resident weeks already over, so the demo's history is not empty.
        now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
        past = [{"parkingSessionId": "demo-past-%d" % i, "locationId": "75001", "startTime": now - timedelta(days=7 * i + 7),
                 "expireTime": now - timedelta(days=7 * i), "vehicle": {"licensePlate": "AB123CD", "type": "Car"},
                 "ratePolicy": {"ratePolicyId": "101", "type": "Resident"},
                 "totalCost": {"amount": 9.0, "currency": "EUR"}} for i in (1, 2)]
        return sorted(self.sessions + past, key=lambda x: x["startTime"], reverse=True)

    def find_locations(self, number):
        # Any 4- or 5-digit number is a French zone in the demo.
        return [{"locationId": str(number), "countryCode": "FR"}] if re.fullmatch(r"\d{4,5}", str(number)) else []

    def get_rate_options(self, locationId, licensePlate):
        if not str(locationId).isdigit():
            return []
        rates = [  # listed first, like PayByPhone does in Paris: it must not be picked for a car
            {"name": "2 roues - Résident", "type": "Resident", "ratePolicyId": "103", "maxStayStatus": None,
             "acceptedTimeUnits": ["Days"], "parkingNotAllowedReason": None},
            {"name": "Résident", "type": "Resident", "ratePolicyId": "101", "maxStayStatus": None,
             "acceptedTimeUnits": ["Days"], "parkingNotAllowedReason": None},
            {"name": "Visiteur - Véhicule léger - 75012-75020", "type": "Visitor", "ratePolicyId": "102",
             "maxStayStatus": None, "acceptedTimeUnits": ["Minutes", "Hours"], "parkingNotAllowedReason": None},
            {"name": "Visiteur - Véhicule lourd - 75012-75020", "type": "Visitor", "ratePolicyId": "104",
             "maxStayStatus": None, "acceptedTimeUnits": ["Minutes", "Hours"], "parkingNotAllowedReason": None},
            {"name": "Handi - toutes zones", "type": "Disabled", "ratePolicyId": "105", "maxStayStatus": None,
             "acceptedTimeUnits": ["Days"], "parkingNotAllowedReason": None},
        ]
        if re.sub(r"[^0-9A-Z]", "", str(licensePlate).upper()) in ("GH456JK", "LM789NP"):  # the demo's vehicles without a resident rate
            rates = [r for r in rates if r["type"] != "Resident"]
        return rates

    def _price(self, ratePolicyId, quantity, unit):
        quantity = float(quantity)
        if str(ratePolicyId) == "105":  # Handi: free with the CMI-S card
            return 0.0
        if str(ratePolicyId) == "101":  # Paris resident rate: 1.50 € a day, 9 € a week
            return round(9 * (quantity // 7) + 1.5 * (quantity % 7), 2)
        hours = quantity / 60 if unit == "Minutes" else quantity
        # Paris visitors: 4 € an hour (zone 2), three times more for a heavy vehicle (over 1.6 t, 2 t electric).
        return round((12.0 if str(ratePolicyId) == "104" else 4.0) * hours, 2)

    @staticmethod
    def _delta(quantity, unit):
        quantity = float(quantity)
        return {"Days": timedelta(days=quantity), "Hours": timedelta(hours=quantity)}.get(
            unit, timedelta(minutes=quantity)
        )

    def _find(self, parkingSessionId):
        return next((x for x in self.sessions if x["parkingSessionId"] == parkingSessionId), None)

    def _create_quote(self, locationId, ratePolicyId, durationQuantity, durationTimeUnit, licensePlate,
                      paymentAccountId="", operation="Start", parkingSessionId=""):
        now = datetime.now(timezone.utc)
        current = self._find(parkingSessionId) if operation == "Extend" else None
        if current:
            now = current["expireTime"].replace(tzinfo=timezone.utc)
        return {
            "quoteId": str(uuid.uuid4()),
            "cost": {"amount": self._price(ratePolicyId, durationQuantity, durationTimeUnit), "currency": "EUR"},
            "details": {
                "locationId": str(locationId),
                "parkingStartTime": now.isoformat(),
                "parkingExpiryTime": (now + self._delta(durationQuantity, durationTimeUnit)).isoformat(),
                "licensePlate": licensePlate,
            },
        }

    def pay(self, durationQuantity, durationTimeUnit, licensePlate, locationId, ratePolicyId, paymentAccountId):
        time.sleep(1.2)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        cost = self._price(ratePolicyId, durationQuantity, durationTimeUnit)
        session = {
            "parkingSessionId": str(uuid.uuid4()),
            "locationId": str(locationId),
            "startTime": now,
            "expireTime": now + self._delta(durationQuantity, durationTimeUnit),
            "vehicle": {"licensePlate": licensePlate},
            "ratePolicy": {"ratePolicyId": str(ratePolicyId)},
            "totalCost": {"amount": cost, "currency": "EUR"},
            "isRenewable": True,
        }
        self.sessions.append(session)
        return {"parkingSessionId": session["parkingSessionId"], "cost": session["totalCost"],
                "expireTime": session["expireTime"].isoformat()}

    def extend(self, parkingSessionId, durationQuantity, durationTimeUnit, licensePlate, locationId, ratePolicyId,
               paymentAccountId):
        time.sleep(1.2)
        current = self._find(parkingSessionId)
        cost = self._price(ratePolicyId, durationQuantity, durationTimeUnit)
        current["expireTime"] += self._delta(durationQuantity, durationTimeUnit)
        current["totalCost"] = {"amount": round(current["totalCost"]["amount"] + cost, 2), "currency": "EUR"}
        return {"parkingSessionId": parkingSessionId, "cost": {"amount": cost, "currency": "EUR"},
                "expireTime": current["expireTime"].isoformat()}


# --------------------------------------------------------------------------
# Sessions (one per browser) and the automatic renewal ("autopilot")
# --------------------------------------------------------------------------


def login_candidates(username):
    """PayByPhone wants phone numbers in international format; people type 06 12 34 56 78."""
    raw = username.strip()
    if "@" in raw:
        return [raw]
    digits = re.sub(r"[\s.\-()]", "", raw)
    candidates = []
    if re.fullmatch(r"0[1-9]\d{8}", digits):  # French national format
        candidates += ["+33" + digits[1:], "+33" + digits]
    elif re.fullmatch(r"(00)?33\d{9,10}", digits):
        candidates.append("+" + digits.lstrip("0"))
    candidates += [digits, raw]
    return list(dict.fromkeys(c for c in candidates if c))


def connect(username, password):
    """Log in, trying the usual phone formats; returns (bot, username that worked)."""
    error = None
    for candidate in login_candidates(username):
        try:
            return Bot(candidate, password), candidate
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code != 400:
                raise
            error = e
    raise error


class UserSession:
    def __init__(self, username, password, demo=False):
        self.username = username
        self._password = password
        self.demo = demo
        self.lock = threading.Lock()
        if demo:
            self.bot = DemoBot()
        else:
            self.bot, self.username = connect(username, password)
        self.autopilots = {}  # id -> dict
        self.account = {}  # e-mail and home zone (hosted accounts live in the database instead)
        self.history = []  # most recent first
        self.attempts = []  # every real payment request, for diagnosis
        self.unconfirmed = {}  # (plate, location) -> time of an unconfirmed payment

    def to_state(self):
        """What the hosted mode keeps in the encrypted cookie: never the password."""
        state = {"u": self.username, "d": self.demo, "iat": getattr(self, "issued_at", int(time.time())),
                 "rm": getattr(self, "remember", False),
                 "uc": [[plate, location, at] for (plate, location), at in self.unconfirmed.items()]}
        if self.demo:
            state["s"] = [{**x, "startTime": x["startTime"].isoformat(), "expireTime": x["expireTime"].isoformat()}
                          for x in self.bot.sessions]
            state["ap"] = list(self.autopilots.values())
            state["acc"] = self.account
        else:
            state["t"] = self.bot.authorization
            state["r"] = getattr(self.bot, "refresh_token", None)
        return state

    @classmethod
    def from_state(cls, state):
        self = cls.__new__(cls)
        self.username, self._password, self.demo = state["u"], None, state["d"]
        self.remember = state.get("rm", False)
        self.lock = threading.Lock()
        if self.demo:
            self.bot = DemoBot()
            self.bot.sessions = [{**x, "startTime": datetime.fromisoformat(x["startTime"]),
                                  "expireTime": datetime.fromisoformat(x["expireTime"])} for x in state.get("s", [])]
        else:
            self.bot = Bot.__new__(Bot)
            self.bot.authorization = state["t"]
            self.bot.refresh_token = state.get("r")
        self.autopilots = {ap["id"]: ap for ap in state.get("ap", [])}
        self.account = state.get("acc", {})
        self.history, self.attempts = [], []
        self.unconfirmed = {(plate, location): at for plate, location, at in state.get("uc", [])}
        return self

    @classmethod
    def for_bot(cls, bot, username=""):
        """A session around an already logged-in bot (background renewals)."""
        self = cls.__new__(cls)
        self.username, self._password, self.demo = username, None, False
        self.lock = threading.Lock()
        self.bot = bot
        self.autopilots, self.history, self.attempts, self.unconfirmed = {}, [], [], {}
        self.account = {}
        return self

    def call(self, method, *args, **kwargs):
        """Call a bot method, logging in again once if the token expired. Calls run side by side (the dashboard
        sends several at once); only logging in again waits for the others, and is done once."""
        if self.demo:  # the demo bot keeps its state in memory: one call at a time
            with self.lock:
                return getattr(self.bot, method)(*args, **kwargs)
        bot = self.bot
        try:
            return getattr(bot, method)(*args, **kwargs)
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code != 401:
                raise
        with self.lock:
            if self.bot is bot:  # not logged in again by a call that failed at the same time
                if self._password is None:  # hosted mode: the password is not kept, the refresh token is
                    try:
                        self.bot = bot_from_refresh(getattr(bot, "refresh_token", None),
                                                    owner_id(self.username) if HOSTED else None)
                    except Exception:
                        raise HTTPException(401, "Votre session PayByPhone a expiré, reconnectez-vous.")
                else:
                    self.bot = Bot(self.username, self._password)
            return getattr(self.bot, method)(*args, **kwargs)

    def log(self, kind, message):
        self.history.insert(0, {"at": datetime.now(timezone.utc).isoformat(), "kind": kind, "message": message})
        del self.history[50:]


SESSIONS = {}


# In hosted mode, the sessions loaded during a request, so the middleware can write them back.
_loaded = contextvars.ContextVar("pbb_loaded", default=None)


def _secrets():
    """Current secret first; PAYBYBOT_SECRET_OLD lets data sealed with the previous one still be read."""
    current_secret = os.environ.get("PAYBYBOT_SECRET") or (None if HOSTED else _local_secret())
    if not current_secret:
        raise RuntimeError("PAYBYBOT_SECRET is not set")
    return [x for x in (current_secret, os.environ.get("PAYBYBOT_SECRET_OLD")) if x]


def _local_secret():
    """On a personal computer: a key made once and kept next to the config, readable by this user only.
    It seals the "Se souvenir de moi" cookie, so a restart of PayByBot does not log out."""
    path = Path("~/.config/paybybot3-web.key").expanduser()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_urlsafe(32))
    return path.read_text().strip()


def _subkey(secret, purpose):
    """Separate keys per use, so one leaked key does not unlock the others."""
    return hashlib.sha256(("paybybot:%s:%s" % (purpose, secret)).encode()).digest()


def _fernet(purpose="cookie"):
    from cryptography.fernet import Fernet, MultiFernet

    return MultiFernet([Fernet(base64.urlsafe_b64encode(_subkey(x, purpose))) for x in _secrets()])


def seal(session):
    state = session.to_state()
    state.setdefault("iat", int(time.time()))
    sealed = _fernet().encrypt(json.dumps(state).encode()).decode()
    if len(sealed) > 3800:  # browsers silently drop a cookie over 4 KB: the session would then be lost
        log.warning("session cookie close to the 4 KB limit: %d bytes (remember=%s)", len(sealed), bool(state.get("rm")))
    return sealed


def current(token):
    if HOSTED:
        try:
            state = json.loads(_fernet().decrypt((token or "").encode(), ttl=REMEMBER))
            idle, most = (REMEMBER, REMEMBER) if state.get("rm") else (SESSION_IDLE, SESSION_MAX)
            if time.time() - _fernet().extract_timestamp((token or "").encode()) > idle:
                raise ValueError("idle too long")
            if time.time() - state.get("iat", 0) > most:
                raise ValueError("login too old")
            session = UserSession.from_state(state)
            session.issued_at = state["iat"]
        except Exception as e:
            # Why a session is refused (never its content): no cookie, unreadable or expired, idle, too old.
            reason = "no cookie" if not token else str(e) if isinstance(e, ValueError) else type(e).__name__
            log.info("session refused: %s (cookie %d bytes)", reason, len(token or ""))
            raise HTTPException(401, "Session expirée, reconnectez-vous.")
        holder = _loaded.get()
        if holder is not None:
            holder.append(session)
        return session
    session = SESSIONS.get(token or "")
    if session is None and token and len(token) > 60:  # "Se souvenir de moi": sealed, survives a restart
        try:
            state = json.loads(_fernet().decrypt(token.encode(), ttl=REMEMBER))
            if not state.get("rm") or time.time() - state.get("iat", 0) > REMEMBER:
                raise ValueError("not remembered")
            session = SESSIONS[token] = UserSession.from_state(state)
            session.issued_at = state["iat"]
        except Exception:
            session = None
    if session is None:
        raise HTTPException(401, "Session expirée, reconnectez-vous.")
    return session


def set_session_cookie(response, value, remember=False):
    """A browser-session cookie, or a 30-day one with "Se souvenir de moi"."""
    response.set_cookie(COOKIE, value, httponly=True, samesite="strict", secure=HOSTED, path="/",
                        max_age=REMEMBER if remember else None)


SECURITY_HEADERS = {
    # Only our own scripts, styles, fonts and API (plus Cloudflare's human check); never shown inside another site's frame (clickjacking).
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; "
                               "style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; "
                               "img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.de.sentry.io; worker-src 'self' blob:; object-src 'none'; "
                               "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",  # origin only: Cloudflare's human check needs our domain
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def same_origin(request):
    """State-changing calls must come from PayByBot's own pages."""
    origin = request.headers.get("origin")
    if origin:
        return origin.split("://", 1)[-1] == request.headers.get("host")
    return request.headers.get("sec-fetch-site") in (None, "same-origin", "none")


@app.middleware("http")
async def persist_session(request: Request, call_next):
    """Origin check, security headers, and (hosted) writing back what a request changed."""
    from fastapi.responses import JSONResponse

    if (request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api/")
            and request.url.path != "/api/cron/renew" and not same_origin(request)):
        return JSONResponse({"detail": "Requête refusée."}, status_code=403, headers=SECURITY_HEADERS)
    holder = []
    _loaded.set(holder)
    response = await call_next(request)
    if HOSTED and holder and response.status_code != 401 and not getattr(holder[-1], "logged_out", False):
        set_session_cookie(response, seal(holder[-1]), getattr(holder[-1], "remember", False))
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if HOSTED:
        response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


RESIDENT_RATE = re.compile(r"r[ée]sid|riverain", re.I)
TWO_WHEELS = re.compile(r"2\s*roues|deux[\s-]*roues|moto|scooter|two[\s-]*wheel", re.I)


def friendly_error(e):
    """Turn a technical exception into a message a non-technical user can act on."""
    text = str(e)
    if isinstance(e, requests.HTTPError) and e.response is not None:
        if e.response.status_code in (400, 401):
            return "Identifiant ou mot de passe PayByPhone incorrect."
        return "PayByPhone ne répond pas correctement (erreur %s). Réessayez dans un instant." % e.response.status_code
    if isinstance(e, requests.ConnectionError):
        return "Impossible de joindre PayByPhone. Vérifiez votre connexion internet."
    if "Quote error" in text:
        log.info("quote refused: %s", re.sub(r'"licensePlate": "[^"]*"', '"licensePlate": "…"', text)[:400])
        if "VehicleAlreadyParked" in text:
            return "Un ticket est déjà en cours pour ce véhicule : PayByPhone n'en accepte pas un second en même temps."
        if "PbpParkingNotAllowed" in text:
            return ("PayByPhone n'autorise pas ce stationnement pour ce véhicule dans cette zone. "
                    "Pour le tarif résident, vérifiez que c'est bien la zone de votre carte résident.")
        return "PayByPhone refuse ce stationnement (zone, tarif ou durée non autorisés)."
    if "Payment job failed" in text:
        return "Le paiement a été refusé. Vérifiez votre moyen de paiement dans l'application PayByPhone."
    if "GraphQL error" in text:  # never show PayByPhone's raw answer
        if "getRateOptions" in text:
            return "PayByPhone ne trouve pas de tarif pour ce véhicule dans cette zone. Vérifiez le numéro de zone."
        return "PayByPhone a renvoyé une erreur. Réessayez dans un instant."
    return "Une erreur est survenue : " + text[:200]


def iso(d):
    """PayByPhone times are UTC; make that explicit so browsers don't read them as local time."""
    if isinstance(d, str):
        try:
            d = datetime.fromisoformat(d.replace("Z", "+00:00"))
        except ValueError:
            return d
    if isinstance(d, datetime):
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()
    return d


def serialize_session(s):
    return {
        "id": s.get("parkingSessionId"),
        "location": s.get("locationId"),
        "plate": (s.get("vehicle") or {}).get("licensePlate"),
        "start": iso(s.get("startTime")),
        "expire": iso(s.get("expireTime")),
        "rate": (s.get("ratePolicy") or {}).get("ratePolicyId"),
        # A resident ticket (the only one the weekly renewal is for)? None when PayByPhone does not say.
        "resident": (bool(RESIDENT_RATE.search((s.get("ratePolicy") or {}).get("type") or ""))
                     if (s.get("ratePolicy") or {}).get("type") else None),
        "cost": s.get("totalCost"),
    }


def card_valid_until(card):
    """Last moment a card can be used: the end of its expiry month (Paris time is close enough); None if unknown."""
    try:
        month, year = int(card.get("expiryMonth")), int(card.get("expiryYear"))
    except (TypeError, ValueError):
        return None
    year += 2000 if year < 100 else 0
    first_next = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    return first_next - timedelta(seconds=1)


def normalize_accounts(accounts, now=None):
    now = now or datetime.now(timezone.utc)
    result = []
    for card in accounts.get("paymentCards") or []:
        masked = card.get("maskedCardNumber") or ""
        label = "%s •••• %s" % (card.get("cardType") or "Carte", masked[-4:])
        until = card_valid_until(card)
        if until:
            label += " — exp. %02d/%s" % (int(card["expiryMonth"]), str(card["expiryYear"])[-2:])
        result.append({"id": card["paymentAccountId"], "label": label, "kind": "card",
                       "validUntil": until.isoformat() if until else None, "expired": bool(until and until < now)})
    for acc in accounts.get("mno") or []:
        result.append({"id": acc["paymentAccountId"], "label": "Facture opérateur %s" % (acc.get("operator") or ""),
                       "kind": "phone"})
    for acc in accounts.get("paypalAccounts") or []:
        result.append({"id": acc["paymentAccountId"], "label": "PayPal", "kind": "paypal"})
    return result


class Unconfirmed(Exception):
    """PayByPhone accepted the payment request but no parking session showed up."""


BANK_CHECK = ("Votre banque n'a pas accepté ce paiement automatique : soit elle demande de valider chaque paiement "
              "(3-D Secure), soit la carte n'est plus utilisable (bloquée, opposée, plafond atteint…). Vérifiez votre "
              "carte, ou ajoutez-en une autre dans l'application PayByPhone, puis relancez le renouvellement. Si vous "
              "avez validé ce paiement dans l'application de votre banque, le ticket apparaîtra dans PayByPhone.")
# The renewal waits for the card holder: never paid again on its own, nor suspended before the time is up.
BANK_WAIT = "Votre banque demande de valider ce paiement (Face ID ou code). Touchez « Valider mon paiement »."
BANK_WAIT_DAY = timedelta(hours=24)  # no ticket running: how long the validation is awaited
BANK_REMIND = timedelta(hours=3)  # no ticket running: reminded this soon; a running week: this long before its end
NO_CARD = ("Aucune carte bancaire dans votre compte PayByPhone : ajoutez-en une dans l'application PayByPhone, "
           "puis relancez le renouvellement.")
CARD_EXPIRED = ("La carte bancaire de votre compte PayByPhone a expiré (%s) : ajoutez votre nouvelle carte dans "
                "l'application PayByPhone. Le renouvellement reprendra tout seul.")
RESIDENT_REFUSED = ("PayByPhone n'accepte plus le tarif résident pour ce véhicule dans cette zone%s. Vérifiez votre "
                    "carte résident dans l'application PayByPhone.")


class BankCheck(Unconfirmed):
    """The bank asked the card holder to confirm the payment (3-D Secure): nothing can be done unattended."""

    def __init__(self, message, job_id=None):
        super().__init__(message)
        self.job_id = job_id


# The e-mails' button: fix the card or the payment there. PayByPhone's own app link (AppsFlyer OneLink, declared
# for its iOS and Android apps): opens the app when installed, else the App Store / Play Store, or its site on a computer.
PAYBYPHONE_URL = "https://paybyphone.onelink.me/ZQkh/"
RETRY_AFTER = timedelta(hours=1)  # a renewal that could not pay is tried again this long after

# PayByPhone bills each SMS confirmation apart from the ticket; PayByBot cannot pay it, so a payment can fail.
SMS_HINT = ("À vérifier aussi : dans l'application PayByPhone, « Notifications relatives au stationnement », la "
            "« Confirmation par SMS » doit être désactivée. Chaque SMS y est facturé 0,50 € à part, et ces frais ne "
            "peuvent pas être payés automatiquement.")

UNCONFIRMED = ("PayByPhone n'a pas confirmé ce stationnement. Vérifiez dans l'application PayByPhone "
               "avant de réessayer, pour ne pas payer deux fois.")


def suspended_message(e):
    return str(e) if isinstance(e, BankCheck) else UNCONFIRMED + " Renouvellement suspendu."


class NotPayable(Exception):
    """Known before paying that PayByPhone will refuse: resident rate no longer granted, no card."""


def check_payable(session, location, rate, plate, payment_account_id, avoid=False):
    """The two usual reasons a renewal cannot be paid, checked before paying: the resident rate is no longer
    offered for this car here (permit expired), or the account has no card left. Returns the card to use: the
    renewal's own, else another card of the account if that one was removed. avoid: the renewal's card was just
    refused, so another valid card of the account is tried first (e.g. one the user added in PayByPhone since)."""
    rates = session.call("get_rate_options", location, plate) or []
    chosen = next((r for r in rates if str(r.get("ratePolicyId")) == str(rate)), None)
    if not chosen or chosen.get("parkingNotAllowedReason"):
        reason = (chosen or {}).get("parkingNotAllowedReason")
        raise NotPayable(RESIDENT_REFUSED % (" (motif PayByPhone : %s)" % reason if reason else ""))
    cards = [p for p in normalize_accounts(session.call("get_payment_accounts") or {}) if p["kind"] == "card"]
    if not cards:
        raise NotPayable(NO_CARD)
    valid = [p["id"] for p in cards if not p["expired"]]
    if not valid:  # every card is past its expiry date: the payment would be refused
        chosen = next((p for p in cards if p["id"] == payment_account_id), cards[0])
        raise NotPayable(CARD_EXPIRED % chosen["label"].split("—")[-1].strip())
    if avoid and payment_account_id in valid and len(valid) > 1:
        return next(p for p in valid if p != payment_account_id)
    return payment_account_id if payment_account_id in valid else valid[0]


def pay_and_confirm(session, location, rate, duration, unit, plate, paymentAccountId, attempts=10, delay=3):
    """Pay, then poll the current sessions like the CLI does: success only once PayByPhone lists it."""
    log.info("pay: zone=%s rate=%s %s %s plate=%s demo=%s", location, rate, duration, unit, plate[:2] + "***",
             session.demo)
    try:
        result = session.call("pay", durationQuantity=duration, durationTimeUnit=unit, licensePlate=plate,
                              locationId=location, ratePolicyId=rate, paymentAccountId=paymentAccountId)
    except Exception as e:
        log.warning("pay: PayByPhone refused: %s", str(e)[:1000])
        raise
    log.info("pay: PayByPhone answered quoteId=%s parkingSessionId=%s jobId=%s jobStatus=%s cost=%s stages=%s",
             result.get("quoteId"), result.get("parkingSessionId"), result.get("jobId"), result.get("jobStatus"),
             result.get("cost"), result.get("jobStages"))
    session.attempts.append({"at": datetime.now(timezone.utc).isoformat(), "location": location, "plate": plate,
                             **{k: result.get(k) for k in ("quoteId", "parkingSessionId", "jobId", "jobStatus")}})
    def visible():
        """The new ticket: by its session id, else this car in this zone (plates compared as written alike)."""
        sessions = session.call("get_parking_sessions") or []
        mine = [x for x in sessions if result.get("parkingSessionId")
                and x.get("parkingSessionId") == result.get("parkingSessionId")]
        return mine or [x for x in sessions if same_plate((x.get("vehicle") or {}).get("licensePlate"), plate)
                        and str(x.get("locationId")) == str(location)]

    if result.get("challenged"):  # the bank asks to confirm: a quick look, then say it
        attempts = min(attempts, 2)
    for i in range(attempts):
        found = visible()
        if found:
            log.info("pay: confirmed after %s check(s)", i + 1)
            return result, found
        if not session.demo:
            time.sleep(delay)
    log.warning("pay: no session visible for zone=%s after %ss (jobStatus=%s stages=%s)", location, attempts * delay,
                result.get("jobStatus"), result.get("jobStages"))
    session.unconfirmed[(plate, location)] = time.time()
    log_diagnosis(session)
    if result.get("challenged") or any(bank_asks(st.get("status")) for st in result.get("jobStages") or []):
        raise BankCheck(BANK_CHECK, result.get("jobId"))
    raise Unconfirmed(UNCONFIRMED)


def diagnosis(session):
    """Unfiltered current sessions and the state of every payment job: no card data in there."""
    report = {"sessions": [], "jobs": []}
    for x in session.call("_get_parking_sessions"):
        report["sessions"].append({
            "id": x.get("parkingSessionId"), "status": x.get("status"), "type": x.get("type"),
            "locationId": x.get("locationId"), "plate": (x.get("vehicle") or {}).get("licensePlate"),
            "start": iso(x.get("startTime")), "expire": iso(x.get("expireTime")), "cost": x.get("totalCost"),
        })
    for a in session.attempts:
        job = None
        if a.get("jobId") and not session.demo:
            try:
                job = session.call("_get_job", a["jobId"])
            except Exception as e:
                job = {"error": str(e)[:300]}
        report["jobs"].append({**a, "job": job})
    return report


def log_diagnosis(session):
    try:
        log.warning("diagnosis: %s", json.dumps(diagnosis(session), default=str))
    except Exception as e:
        log.warning("diagnosis failed: %s", e)


def parse_dt(value):
    if not value:
        return None
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def paused_now(paused_from, paused_until, now=None):
    """A pause runs from paused_from (included) to paused_until (excluded, None = no end yet)."""
    now = now or datetime.now(timezone.utc)
    start, end = parse_dt(paused_from), parse_dt(paused_until)
    return bool(start) and start <= now and (end is None or now < end)


def pause_bounds(first_day, last_day):
    """Dates picked in the interface are Paris days: from first_day 00:00 to the day after last_day 00:00."""
    start = datetime.combine(date.fromisoformat(first_day), dtime(0), PARIS)
    end = datetime.combine(date.fromisoformat(last_day) + timedelta(days=1), dtime(0), PARIS) if last_day else None
    if end and end <= start:
        raise HTTPException(422, "La date de fin doit être après la date de début.")
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat() if end else None


def paris_text(value, tz=None):
    """A date in words, in Paris time (or the given time zone: a ticket programmed elsewhere)."""
    dt = parse_dt(value)
    if not dt:
        return ""
    local = dt.astimezone(tz or PARIS)
    days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
    months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
              "novembre", "décembre"]
    return "%s %d %s à %s" % (days[local.weekday()], local.day, months[local.month - 1], local.strftime("%H:%M"))


def plate_text(plate):
    return "%s-%s-%s" % (plate[:2], plate[2:5], plate[5:]) if re.fullmatch(r"[A-Z]{2}\d{3}[A-Z]{2}", plate or "") else plate


CURRENCY_SIGNS = {"EUR": "€", "GBP": "£", "USD": "$", "CAD": "$ CA", "AUD": "$ AU", "CHF": "CHF"}


def money_text(cost):
    """« 9,00 € », « 2,50 £ »: the amount in PayByPhone's own currency (euros when it does not say)."""
    if not cost or cost.get("amount") is None:
        return ""
    sign = CURRENCY_SIGNS.get(str(cost.get("currency") or "EUR").upper(), str(cost.get("currency") or "€"))
    return ("%.2f %s" % (float(cost["amount"]), sign)).replace(".", ",")


RENEWAL_FOOTER = ("Vous recevez cet e-mail parce que vous avez activé le renouvellement automatique sur PayByBot. Pour ne "
                  "plus en recevoir, retirez votre adresse ou arrêtez le renouvellement depuis l'application.")


SITE_URL = "https://paybybot.fr"


def email_html(title, lines, button=None, footer=RENEWAL_FOOTER, code=None):
    """The PayByBot look for transactional e-mails: logo, white card, blue button, legal footer."""
    from html import escape

    font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
    def paragraphs(xs):
        return "".join('<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#3d4350">%s</p>' % escape(x)
                       for x in xs)

    body = paragraphs(lines)
    if code:  # the code stands out, right after the sentence that introduces it
        body = paragraphs(lines[:1]) + (
            '<p style="margin:6px 0 18px;padding:18px 0;border-radius:12px;background:#f1f4fb;text-align:center;'
            'font-size:34px;font-weight:700;letter-spacing:8px;color:#111111">%s</p>' % escape(code)) + paragraphs(lines[1:])
    cta = ('<p style="margin:22px 0 4px"><a href="%s" style="display:inline-block;background:#1d4ea3;'
           'background-image:linear-gradient(90deg,#1d4ea3,#2a66d1);color:#ffffff;padding:13px 22px;border-radius:12px;'
           'font-size:16px;font-weight:700;text-decoration:none">%s</a></p>'
           % (escape(button[1]), escape(button[0]))) if button else ""
    return (
        '<div style="margin:0;padding:32px 16px;background:#ffffff;%s">'
        '<div style="max-width:520px;margin:0 auto">'
        '<p style="margin:0 0 18px 4px"><a href="%s" style="text-decoration:none">'
        '<img src="%s/brand/paybybot-email-logo.png" width="150" alt="PayByBot" style="display:block;border:0;height:auto"></a></p>'
        '<div style="background:#ffffff;border:1px solid #e6e8ee;border-radius:16px;padding:32px 28px">'
        '<h1 style="margin:0 0 16px;font-size:23px;line-height:1.25;letter-spacing:-0.3px;color:#111111">%s</h1>%s%s'
        "</div>"
        '<p style="margin:20px 4px 0;font-size:12.5px;line-height:1.55;color:#7a8091">%s</p>'
        '<p style="margin:10px 4px 0;font-size:12.5px;line-height:1.55;color:#7a8091">'
        'PayByBot · Studio Presto · <a href="mailto:%s" style="color:#7a8091">%s</a> · '
        '<a href="%s" style="color:#7a8091">paybybot.fr</a><br>PayByBot est un service indépendant de PayByPhone.</p>'
        "</div></div>"
        % (font, SITE_URL, SITE_URL, escape(title), body, cta, escape(footer), MAIL_REPLY_TO, MAIL_REPLY_TO, SITE_URL)
    )


def send_email(to, subject, title, lines, button=None, footer=RENEWAL_FOOTER, code=None, reply_to=None, count=True):
    """Transactional e-mail through Resend. Silently skipped without an address or an API key. Each one sent is
    counted against Resend's quota (`count=False` for the capacity alerts themselves)."""
    key = os.environ.get("RESEND_API_KEY")
    if not to or not key:
        return False
    html = email_html(title, lines, button, footer, code)
    text = "\n\n".join([title] + list(lines[:1]) + ([code] if code else []) + list(lines[1:])
                         + ([button[0] + " : " + button[1]] if button else []))
    try:
        r = requests.post("https://api.resend.com/emails", timeout=10,
                          headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
                          json={"from": MAIL_FROM, "to": [to], "reply_to": reply_to or MAIL_REPLY_TO, "subject": subject,
                                "html": html, "text": text})
        log.info("e-mail '%s': %s", title, r.status_code)  # the title, never the address nor a code from the subject
        if not r.ok:
            log.warning("e-mail refused by Resend: %s", r.text[:200])
            if count and (r.status_code == 429 or "quota" in r.text):
                capacity_alert("email-refused:" + paris_day(), "Resend refuse les e-mails",
                               ["Resend refuse d'envoyer : quota d'e-mails atteint (%s)." % r.text[:120],
                                "Les clients ne reçoivent plus les e-mails de PayByBot (les tickets sont toujours "
                                "payés). Passez Resend sur un plan supérieur, puis réglez PAYBYBOT_EMAIL_DAY_LIMIT "
                                "et PAYBYBOT_EMAIL_MONTH_LIMIT sur Vercel."])
        elif count:
            count_email()
        return r.ok
    except Exception as e:
        log.warning("e-mail '%s' failed: %s", title, e)
        return False


def alert_owner(details, info):
    """A renewal that failed: PayByBot's owner hears of each one (an e-mail and an error in Sentry), not only the
    customer, so nobody gets a fine unnoticed. No personal data: the plate cut short, the zone and the reason."""
    plate = str((details or {}).get("plate") or "")
    text = "renouvellement échoué : %s*** zone %s — %s%s" % (
        plate[:2], (details or {}).get("location"), info.get("message", ""),
        " (suspendu)" if info.get("suspended") else "")
    log.error("owner alert, %s", text)  # an ERROR log: Sentry raises an issue for it
    to = owner_address()
    if not to:
        return
    try:
        send_email(to, "Alerte PayByBot · renouvellement échoué", "Un renouvellement a échoué",
                   ["Véhicule %s***, zone %s." % (plate[:2], (details or {}).get("location")),
                    "Raison : %s" % (info.get("message") or "inconnue"),
                    "Renouvellement suspendu." if info.get("suspended") else "Nouvel essai automatique prévu.",
                    "Le client a été prévenu par e-mail s'il en a donné un."],
                   ("Ouvrir l'admin", APP_URL.rstrip("/") + "/#/admin"))
    except Exception as e:
        log.warning("owner alert not sent: %s", type(e).__name__)


def record_activity(event, s=None, lines=()):
    """Each user action (sign-up, sign-in, invitation opened, renewal on or off, subscription…) recorded for the
    admin's « Activité », with who did it (encrypted, kept 90 days). Not for the demo, the owner's own accounts nor
    locally. Never raises."""
    if not HOSTED or (s is not None and (s.demo or is_admin(s))):
        return
    try:
        who = None
        if s is not None:
            try:
                email = load_account(s).get("email")
            except Exception:
                email = None
            who = " · ".join(x for x in (first_name(s), email or s.username[:4] + "***") if x)
        data = _fernet("activity").encrypt(json.dumps({"who": who, "detail": " ".join(lines)}).encode()).decode()
        store("activity_add", p_event=event, p_data=data)
    except Exception as e:
        log.warning("activity not recorded: %s", type(e).__name__)


def activity_rows(limit=200):
    """The latest actions for the admin, decrypted: [{at, event, who, detail}], newest first."""
    rows = []
    for row in store("activity_list", p_limit=limit) or []:
        try:
            data = json.loads(_fernet("activity").decrypt((row.get("data") or "").encode()))
        except Exception:
            data = {}
        rows.append({"id": row.get("id"), "at": row.get("at"), "event": row.get("event"), "who": data.get("who"),
                     "detail": data.get("detail") or None, "visitor": data.get("visitor") or None})
    return rows


# --------------------------------------------------------------------------
# Capacity alerts: the owner hears before a limit of the stack is reached
# --------------------------------------------------------------------------

USER_STEPS = (20, 50, 100, 200, 500, 1000)  # accounts with something running: each step crossed is told once
DB_LIMIT_BYTES = 500 * 2**20  # Supabase free plan


def paris_day(now=None):
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")


def capacity_alert(key, subject, lines):
    """One alert per key, ever (put the day or the month in the key to repeat it): an ERROR log for Sentry and an
    e-mail to the owner. Never raises; True when it went out."""
    try:
        counts = store("usage_add", p_keys=["alert:" + key]) or {}
    except Exception as e:
        log.warning("capacity alert not recorded: %s", type(e).__name__)
        return False
    if counts.get("alert:" + key) != 1:
        return False
    log.error("capacity alert: %s", subject)
    try:
        send_email(owner_address(), "Alerte PayByBot · " + subject, subject, lines,
                   ("Ouvrir l'admin", APP_URL.rstrip("/") + "/#/admin"), count=False)
    except Exception as e:
        log.warning("capacity alert not sent: %s", type(e).__name__)
    return True


def count_email(now=None):
    """One more e-mail sent: at 80 % of Resend's daily or monthly quota, the owner is told (once a day / a month)."""
    if not HOSTED:
        return
    day = paris_day(now)
    month = day[:7]
    day_limit = int(os.environ.get("PAYBYBOT_EMAIL_DAY_LIMIT") or 100)  # Resend free plan
    month_limit = int(os.environ.get("PAYBYBOT_EMAIL_MONTH_LIMIT") or 3000)
    try:
        counts = store("usage_add", p_keys=["email:day:" + day, "email:month:" + month]) or {}
    except Exception as e:
        log.info("e-mail not counted: %s", type(e).__name__)
        return
    advice = "Au-delà, les e-mails aux clients ne partent plus (les tickets sont toujours payés). Passez Resend sur " \
             "un plan supérieur, puis réglez PAYBYBOT_EMAIL_DAY_LIMIT et PAYBYBOT_EMAIL_MONTH_LIMIT sur Vercel."
    sent_today, sent_month = counts.get("email:day:" + day, 0), counts.get("email:month:" + month, 0)
    if sent_today >= 0.8 * day_limit:
        capacity_alert("email-day:" + day, "quota d'e-mails du jour bientôt atteint",
                       ["%s e-mails envoyés aujourd'hui sur %s autorisés par Resend." % (sent_today, day_limit), advice])
    if sent_month >= 0.8 * month_limit:
        capacity_alert("email-month:" + month, "quota d'e-mails du mois bientôt atteint",
                       ["%s e-mails envoyés ce mois-ci sur %s autorisés par Resend." % (sent_month, month_limit),
                        advice])


def check_capacity(now=None):
    """Run by the scheduler: the renewals queue, the number of customers, the database size. Never raises."""
    try:
        snap = store("capacity_snapshot")
    except Exception as e:
        log.info("capacity not checked: %s", type(e).__name__)
        return
    if not isinstance(snap, dict):
        return
    day = paris_day(now)
    if snap.get("overdue"):
        capacity_alert("queue:" + day, "renouvellements en retard",
                       ["%s renouvellement(s) attendent depuis plus de 10 minutes après leur heure : le robot ne suit "
                        "plus (il en traite %s toutes les 5 minutes)." % (snap["overdue"], CLAIM_PER_RUN),
                        "Risque d'amende pour ces clients. Augmentez CLAIM_PER_RUN dans web.py."])
    owners = snap.get("owners") or 0
    for step in USER_STEPS:
        if owners >= step:
            capacity_alert("users:%s" % step, "%s clients actifs" % step,
                           ["%s comptes ont un renouvellement ou un ticket programmé actif." % owners,
                            "À vérifier à ce palier : le quota d'e-mails Resend, les plans Vercel et Supabase, et "
                            "les erreurs « trop de requêtes » de PayByPhone dans Sentry."])
    if (snap.get("db_bytes") or 0) >= 0.8 * DB_LIMIT_BYTES:
        capacity_alert("db:" + day[:7], "base de données bientôt pleine",
                       ["La base Supabase fait %s Mo sur %s Mo du plan gratuit."
                        % (snap["db_bytes"] // 2**20, DB_LIMIT_BYTES // 2**20),
                        "Passez Supabase en Pro avant d'atteindre la limite."])


PROBE_FROM_HOUR = 8  # Paris time: the owner hears of it in the morning, not at midnight


def probe_error(what, e):
    """« Lecture impossible : véhicules (erreur HTTP 400). », for the owner (never the test account's password)."""
    status = e.response.status_code if isinstance(e, requests.HTTPError) and e.response is not None else None
    return "Lecture impossible : %s (%s)." % (what, "erreur HTTP %s" % status if status else str(e)[:300])


def run_probe(now=None):
    """Once a day, the test account read on PayByPhone (login, vehicles, cards, tickets; nothing paid): the owner is
    told when the API refuses or answers differently, whatever the error (a 400, a GraphQL error, a field gone).
    PAYBYBOT_PROBE_LOGIN and PAYBYBOT_PROBE_PASSWORD on Vercel; without them, nothing runs. Never raises.
    Returns "ok", "alert", or None when it did not run."""
    login, password = os.environ.get("PAYBYBOT_PROBE_LOGIN"), os.environ.get("PAYBYBOT_PROBE_PASSWORD")
    now = now or datetime.now(timezone.utc)
    if not login or not password or now.astimezone(ZoneInfo("Europe/Paris")).hour < PROBE_FROM_HOUR:
        return None
    day = paris_day(now)
    try:
        if (store("usage_add", p_keys=["probe:" + day]) or {}).get("probe:" + day) != 1:
            return None
    except Exception as e:
        log.info("probe not run: %s", type(e).__name__)
        return None
    problems = []
    try:
        bot, _ = connect(login, password)
    except Exception as e:
        problems.append(probe_error("connexion", e))
    else:
        def read(what, call, check):
            try:
                gone = check(call())
                if gone:
                    problems.append("Réponse différente : %s (%s absent)." % (what, gone))
            except Exception as e:
                problems.append(probe_error(what, e))

        def vehicles(rows):
            return next((f for r in rows for f in ("vehicleId", "licensePlate") if not r.get(f)), None)

        def cards(accounts):
            if not isinstance(accounts.get("paymentCards"), list):
                return "paymentCards"
            # Only the id: PayByPhone may not know a card's expiry, and a field it drops is a GraphQL error anyway.
            return next(("paymentAccountId" for c in accounts["paymentCards"] if not c.get("paymentAccountId")), None)
        read("véhicules", bot.get_vehicles, vehicles)
        read("cartes", bot.get_payment_accounts, cards)
        read("tickets", bot.get_parking_sessions, lambda rows: None if isinstance(rows, list) else "liste")
    if not problems:
        log.info("probe ok")
        return "ok"
    capacity_alert("probe:" + day, "PayByPhone ne répond plus comme prévu",
                   problems + ["Sonde quotidienne sur le compte de test, rien n'a été payé. Les renouvellements des "
                               "clients risquent d'échouer : à regarder aujourd'hui."])
    return "alert"


def owner_address():
    """Where PayByBot's owner gets the alerts."""
    return (os.environ.get("PAYBYBOT_ALERT_EMAIL") or os.environ.get("PAYBYBOT_ADMIN_EMAIL") or "").split(",")[0].strip()


# --------------------------------------------------------------------------
# Service interruption: PayByPhone stops answering (API blocked, down)
# --------------------------------------------------------------------------

OUTAGE_AFTER = 3  # renewals in a row PayByPhone did not answer: the service is marked interrupted


def is_outage(e):
    """PayByPhone refusing every call (403, 429), down (5xx) or unreachable: not the user's own problem."""
    if isinstance(e, requests.HTTPError) and e.response is not None:
        code = e.response.status_code
        return code in (403, 429) or code >= 500
    return isinstance(e, (requests.ConnectionError, requests.Timeout))


def outage_hit():
    """One more renewal PayByPhone did not answer; the one that crosses the threshold alerts the owner, who then
    decides in the admin whether to write to the customers. Never raises."""
    try:
        state = store("service_outage_hit", p_threshold=OUTAGE_AFTER) or {}
    except Exception as e:
        log.warning("outage not counted: %s", type(e).__name__)
        return
    if not state.get("started"):
        return
    log.error("service interrupted: PayByPhone did not answer %s renewals in a row", state.get("failures"))
    try:
        send_email(owner_address(), "Alerte PayByBot · PayByPhone ne répond plus", "PayByBot est interrompu",
                   ["PayByPhone n'a pas répondu à %s renouvellements d'affilée (accès bloqué ou panne)."
                    % state.get("failures"),
                    "La bannière d'interruption est affichée dans l'app.",
                    "Les clients n'ont pas encore été prévenus : validez l'envoi de l'e-mail dans l'admin, ou "
                    "rétablissez le service si la panne est déjà passée."],
                   ("Ouvrir l'admin", APP_URL.rstrip("/") + "/#/admin"))
    except Exception as e:
        log.warning("outage alert not sent: %s", type(e).__name__)


def outage_clear():
    """PayByPhone answered: the count of failures in a row starts again. Never raises."""
    try:
        store("service_outage_clear")
    except Exception as e:
        log.info("outage count not cleared: %s", type(e).__name__)


_service_cache = {"at": 0.0, "value": False}


def service_interrupted():
    """Whether the app shows the interruption banner (read at most every 30 s; PAYBYBOT_INTERRUPTED=1 forces it)."""
    if os.environ.get("PAYBYBOT_INTERRUPTED") == "1":
        return True
    if not HOSTED:
        return False
    if time.time() - _service_cache["at"] < 30:
        return _service_cache["value"]
    try:
        value = bool((store("service_state_get") or {}).get("interrupted_at"))
    except Exception as e:
        log.info("service state unreadable: %s", type(e).__name__)
        value = _service_cache["value"]
    _service_cache.update(at=time.time(), value=value)
    return value


def outage_recipients():
    """The e-mails of the accounts with a renewal or a programmed ticket running, once each."""
    found = set()
    for row in store("admin_accounts") or []:
        if not row.get("renewals_active"):
            continue
        try:
            email = json.loads(_fernet("account").decrypt(row["data"].encode())).get("email")
        except Exception:
            continue
        if email and email.strip():
            found.add(email.strip().lower())
    return sorted(found)


OUTAGE_FOOTER = "Vous recevez cet e-mail parce qu'un renouvellement ou un ticket programmé est actif sur votre compte PayByBot."


def service_action(action):
    """The owner's choice in the admin: 'interrupt' (banner on), 'notify' (the customers' e-mail, once), 'resume'
    (banner off; the customers who were told get the resume e-mail). Returns the state and the e-mails sent."""
    sent = 0
    if action == "interrupt":
        state = store("service_state_set", p_action="interrupt")
    elif action == "notify":
        state = store("service_state_get") or {}
        if not state.get("notified_at"):
            for to in outage_recipients():
                sent += bool(send_email(
                    to, "PayByBot interrompu · payez votre stationnement vous-même", "PayByBot est interrompu",
                    ["PayByPhone ne répond plus à PayByBot : vos tickets ne sont plus pris ni renouvelés "
                     "automatiquement.",
                     "Jusqu'à nouvel ordre, ne comptez plus sur PayByBot : payez votre stationnement vous-même dans "
                     "l'app PayByPhone.",
                     "Vos tickets en cours restent valables jusqu'à leur fin. Nous vous écrirons dès que le service "
                     "reprend."], footer=OUTAGE_FOOTER))
            state = store("service_state_set", p_action="interrupt")
            state = store("service_state_set", p_action="notified")
    elif action == "resume":
        before = store("service_state_get") or {}
        if before.get("notified_at"):
            for to in outage_recipients():
                sent += bool(send_email(
                    to, "PayByBot fonctionne de nouveau", "PayByBot fonctionne de nouveau",
                    ["PayByPhone répond de nouveau : vos tickets sont de nouveau pris et renouvelés automatiquement.",
                     "Ouvrez PayByBot pour vérifier que vos renouvellements sont bien actifs."],
                    ("Ouvrir PayByBot", APP_URL), footer=OUTAGE_FOOTER))
        state = store("service_state_set", p_action="resume")
    else:
        raise HTTPException(400, "Action inconnue.")
    _service_cache.update(at=0.0)
    log.info("service %s by the owner: %s e-mails", action, sent)
    return {**(state or {}), "sent": sent}


def notify(details, event, **info):
    """One message per renewal event; the address lives only in the encrypted details."""
    if event == "problem":
        alert_owner(details, info)
        if info.get("message") == BANK_WAIT:
            notify_bank(details)
            return
    to = (details or {}).get("email")
    if not to:
        return
    car = "%s, zone %s" % (plate_text(details.get("plate")), details.get("location"))
    open_app = ("Ouvrir PayByBot", APP_URL)
    rule = rule_of(details)
    if event == "activated" and rule:
        lines = ["Les tickets automatiques sont activés pour %s, %s." % (car, rule_text(rule))]
        tz = schedule.zone_of(rule)
        if info.get("expire"):
            lines.append("Un ticket couvre déjà votre véhicule jusqu'au %s." % paris_text(info["expire"], tz))
        if info.get("next"):
            lines.append("Prochain ticket : %s." % paris_text(info["next"], tz))
        if schedule.in_paris(rule):
            lines.append("Rien n'est payé les dimanches et jours fériés, gratuits à Paris.")
        send_email(to, "Tickets automatiques activés · %s" % plate_text(details.get("plate")),
                   "Tickets automatiques activés", lines, open_app)
    elif event == "activated":
        lines = ["Le renouvellement automatique de votre forfait résident est activé pour %s." % car]
        if info.get("message"):
            lines += list(info["message"])
        elif info.get("expire"):
            lines.append("Votre véhicule est couvert jusqu'au %s." % paris_text(info["expire"]))
        lines.append(PAY_YOURSELF)
        send_email(to, "Renouvellement activé · %s" % plate_text(details.get("plate")), "Renouvellement activé",
                   lines, open_app)
    elif event == "advanced":
        send_email(to, "Ticket avancé par PayByBot · %s" % plate_text(details.get("plate")), "Votre ticket a été avancé",
                   ["Votre carte bancaire n'a pas pu payer le forfait de %s." % car,
                    "Pour que votre véhicule reste couvert, PayByBot a payé ce forfait%s. Il sera ajouté à votre "
                    "prochain prélèvement PayByBot." % ((" (%s)" % money_text(info.get("cost")))
                                                         if money_text(info.get("cost")) else ""),
                    "Valable jusqu'au %s. Ce ticket n'apparaît pas dans votre application PayByPhone, mais il "
                    "couvre bien votre plaque." % paris_text(info.get("expire")),
                    "Vérifiez votre carte dans l'application PayByPhone : le prochain paiement l'essaiera en premier."],
                   ("Ouvrir PayByPhone", PAYBYPHONE_URL))
    elif event == "paid":
        send_email(to, "Forfait renouvelé · %s" % plate_text(details.get("plate")), "Forfait renouvelé",
                   ["Un nouveau forfait de %s a été payé automatiquement pour %s%s." % (
                       duration_text(details.get("duration"), details.get("unit")),
                       car, (" (%s)" % money_text(info.get("cost"))) if money_text(info.get("cost")) else ""),
                    "Valable jusqu'au %s." % paris_text(info.get("expire")),
                    "Le ticket apparaît aussi dans votre application PayByPhone."]
                   + (["Prochain ticket : %s." % paris_text(info["next"])] if info.get("next") else []), open_app)
    elif event == "paused":
        until = ("jusqu'au %s inclus" % info["until_day"]) if info.get("until_day") else "sans date de fin"
        send_email(to, "Renouvellement en pause · %s" % plate_text(details.get("plate")), "Renouvellement en pause",
                   ["Aucun forfait ne sera payé pour %s à partir du %s, %s." % (car, info.get("from_day"), until),
                    "Un ticket déjà en cours reste valable jusqu'à sa fin."], open_app)
    elif event == "problem":
        message = info.get("message", "")
        if message == RELOGIN:  # only a new login on PayByBot fixes it
            send_email(to, "Action requise · renouvellement %s" % plate_text(details.get("plate")),
                       "Le renouvellement a besoin de vous",
                       ["Le renouvellement automatique pour %s est en attente :" % car, message], open_app)
            return
        next_step = ("Le renouvellement est suspendu : une fois le problème réglé dans PayByPhone, relancez-le "
                     "depuis PayByBot." if info.get("suspended") else
                     "Réglez-le dans l'application PayByPhone : nous réessayons automatiquement dans une heure.")
        send_email(to, "Action requise · renouvellement %s" % plate_text(details.get("plate")),
                   "Le renouvellement a besoin de vous",
                   ["Le renouvellement automatique pour %s n'a pas pu payer :" % car, message, next_step,
                    SMS_HINT], ("Ouvrir PayByPhone", PAYBYPHONE_URL))


def notify_bank(details):
    """The bank wants the payment confirmed: on the client's phone if they accepted alerts, and by e-mail."""
    link = validate_link(details.get("owner"), details.get("id"))
    plate = plate_text(details.get("plate"))
    send_push(details.get("owner"), "Votre banque demande une validation",
              "Touchez ici pour valider le ticket de %s." % plate, link)
    send_email(details.get("email"), "Votre banque demande une validation · %s" % plate, "Validez votre paiement",
               ["Votre banque demande de confirmer le paiement du ticket de %s, zone %s (Face ID ou code)."
                % (plate, details.get("location")),
                "Sans cette validation, le ticket ne sera pas renouvelé."], ("Valider mon paiement", link))


DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def rule_of(details):
    """The "precise days" rule of a renewal, or None for the continuous weekly renewal."""
    days = (details or {}).get("days")
    if not days:
        return None
    return {"days": sorted({int(d) for d in days}), "start": details.get("start") or schedule.DEFAULT_START,
            "unit": details.get("unit"), "duration": details.get("duration"), "location": details.get("location"),
            "tz": details.get("tz"),
            # Chosen on the calendar: a single day or a period (stored snake_case, sent camelCase by the demo).
            "date_from": details.get("date_from") or details.get("dateFrom") or None,
            "date_to": details.get("date_to") or details.get("dateTo") or None}


def duration_text(duration, unit):
    n = fmt_qty(float(duration or 0))
    word = {"Days": "jour", "Hours": "heure", "Minutes": "minute"}.get(unit, unit)
    return "%s %s%s" % (str(n).replace(".", ","), word, "s" if float(n) > 1 else "")


def rule_text(rule):
    """'chaque samedi', 'du mardi au vendredi'... with the time the ticket is taken."""
    days = rule["days"]
    first, last = rule.get("date_from"), rule.get("date_to")
    if first and last:  # chosen on the calendar: the day, or the period
        when = ("le %s" % day_text(first)) if first == last else "du %s au %s" % (day_text(first), day_text(last))
    elif len(days) > 2 and days == list(range(days[0], days[-1] + 1)):
        when = "du %s au %s" % (DAY_NAMES[days[0]], DAY_NAMES[days[-1]])
    else:
        names = [DAY_NAMES[d] for d in days]
        when = "chaque " + (names[0] if len(names) == 1 else ", ".join(names[:-1]) + " et " + names[-1])
    h, m = rule["start"].split(":")
    start = "%dh%s" % (int(h), "" if m == "00" else m)
    if rule.get("unit") == "Days":
        return "%s, ticket d'une journée pris à %s" % (when, start)
    return "%s, ticket de %s pris à %s" % (when, duration_text(rule.get("duration"), rule.get("unit")), start)


MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
               "novembre", "décembre"]


def day_text(iso):
    """'2026-10-26' -> 'lundi 26 octobre'."""
    d = date.fromisoformat(iso)
    return "%s %d %s" % (DAY_NAMES[d.weekday()], d.day, MONTH_NAMES[d.month - 1])


def same_plate(a, b):
    return re.sub(r"[^0-9A-Z]", "", (a or "").upper()) == re.sub(r"[^0-9A-Z]", "", (b or "").upper())


def running_for(session, plate):
    """Tickets running now for this car, in any zone: PayByPhone refuses a second one at the same time
    (VehicleAlreadyParked), so a renewal waits for the end of whichever is running."""
    now = datetime.now(timezone.utc)
    return [x for x in session.call("get_parking_sessions")
            if same_plate((x.get("vehicle") or {}).get("licensePlate"), plate)
            and (parse_dt(x.get("expireTime")) or now) > now]


def covered_until(active):
    return max((x["expireTime"] for x in active), default=None)


EARLY_RENEWAL = timedelta(hours=24)  # PayByPhone offers « Prolonger » this long before the end of a resident week
EXTEND_HOUR = 20  # the weekly renewal extends the running week at 20:00 (Paris) the day before it ends


def extension_time(ends):
    """When the weekly renewal extends a week ending at `ends`: 20:00 (Paris) the day before, and never before
    PayByPhone offers to extend (24 hours before the end), e.g. a week ending at 23:00 is extended at 23:00 the day
    before."""
    ends = aware(ends)
    day_before = (ends.astimezone(PARIS) - timedelta(days=1)).replace(hour=EXTEND_HOUR, minute=0, second=0,
                                                                         microsecond=0)
    return max(day_before.astimezone(timezone.utc), ends - EARLY_RENEWAL + timedelta(minutes=1))

PAY_YOURSELF = ("Si un paiement échoue, vous serez prévenu aussitôt par e-mail. Il vous reviendra alors de payer "
                "vous-même votre ticket dans l'application PayByPhone : tant que ce ne sera pas fait, votre véhicule "
                "ne sera pas couvert.")


def activation_message(case, expire, next_payment):
    """What activating a weekly renewal did, the same on screen and in the e-mail: (title, text)."""
    if case == "first":
        return ("Première semaine payée : vous êtes couvert jusqu'au %s." % paris_text(expire),
                "La semaine suivante sera payée la veille.")
    if case == "extended":
        return ("Semaine suivante payée : vous êtes couvert jusqu'au %s." % paris_text(expire),
                "La suivante sera payée la veille.")
    if case == "later":
        return ("Votre ticket court jusqu'au %s." % paris_text(expire),
                "Nous paierons la semaine suivante la veille, le %s." % paris_text(next_payment))
    return ("Votre ticket se termine le %s." % paris_text(expire),
            "La semaine suivante sera achetée à sa fin.")


def activation_case(outcome, before, after, row, now=None):
    """Which of the activation cases happened, from the tickets running before and after the first look:
    'first' (a first week paid, now or by the check just before), 'extended' (the running ticket extended),
    'later' (extended a day before its end), 'atEnd' (a ticket PayByBot cannot extend: bought at its end)."""
    now = now or datetime.now(timezone.utc)
    if not after:
        return None, None, None
    expire = aware(covered_until(after))
    if outcome == "paid":
        return ("extended" if before else "first"), expire, extension_time(expire)
    ticket = extendable(after, row)
    started = aware((ticket or {}).get("startTime"))
    if ticket and started and now - started < timedelta(hours=2):  # the first week the check just paid
        return "first", expire, extension_time(expire)
    if ticket:
        return "later", expire, extension_time(expire)
    return "atEnd", expire, expire


def aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def extendable(active, row):
    """The running ticket a weekly renewal can extend: the one ending last, in its zone and at its resident rate."""
    last = max(active, key=lambda x: aware(x["expireTime"]), default=None)
    if last and str(last.get("locationId")) == str(row["location"]) \
            and str((last.get("ratePolicy") or last.get("rateOption") or {}).get("ratePolicyId")) == str(row["rate"]):
        return last
    return None


def extend_and_confirm(session, ticket, row, card, attempts=10, delay=3):
    """Add the next week to the running ticket, then poll until PayByPhone shows its later end."""
    before = aware(ticket["expireTime"])
    log.info("renewal extend: zone=%s plate=%s", row["location"], row["plate"][:2] + "***")
    result = session.call("extend", parkingSessionId=ticket["parkingSessionId"], durationQuantity=fmt_qty(row["duration"]),
                          durationTimeUnit=row["unit"], licensePlate=row["plate"], locationId=row["location"],
                          ratePolicyId=row["rate"], paymentAccountId=card)
    session.attempts.append({"at": datetime.now(timezone.utc).isoformat(), "location": row["location"],
                             "plate": row["plate"], "operation": "extend",
                             **{k: result.get(k) for k in ("quoteId", "parkingSessionId", "jobId", "jobStatus")}})
    if result.get("challenged"):  # the bank asks to confirm: a quick look, then say it
        attempts = min(attempts, 2)
    for i in range(attempts):
        now_ticket = next((x for x in session.call("get_parking_sessions") or []
                           if x.get("parkingSessionId") == ticket["parkingSessionId"]), None)
        if now_ticket and aware(now_ticket["expireTime"]) > before:
            log.info("renewal extend: confirmed after %s check(s)", i + 1)
            return result, [now_ticket]
        if not session.demo:
            time.sleep(delay)
    log.warning("renewal extend: end time unchanged (jobStatus=%s stages=%s)", result.get("jobStatus"),
                result.get("jobStages"))
    session.unconfirmed[(row["plate"], row["location"])] = time.time()
    log_diagnosis(session)
    if result.get("challenged") or any(bank_asks(st.get("status")) for st in result.get("jobStages") or []):
        raise BankCheck(BANK_CHECK, result.get("jobId"))
    raise Unconfirmed(UNCONFIRMED)


def run_autopilot(session, ap, now=None):
    """Pay for the configured parking if no session is active right now (and, for precise days, if it is time)."""
    now = now or datetime.now(timezone.utc)
    rule = rule_of(ap)
    if rule:
        due, _ = schedule.decide(rule, now, ap.get("pausedFrom"), ap.get("pausedUntil"), ap.get("lastPayment"))
        ap["lastCheck"] = now.isoformat()
        if not due:
            return
    elif paused_now(ap.get("pausedFrom"), ap.get("pausedUntil")):
        ap["lastCheck"] = now.isoformat()
        return
    active = running_for(session, ap["plate"])
    ap["lastCheck"] = datetime.now(timezone.utc).isoformat()
    if rule and active:
        due, _ = schedule.decide(rule, now, ap.get("pausedFrom"), ap.get("pausedUntil"), ap.get("lastPayment"),
                                 covered_until(active))
        if not due:
            return
    if active:
        return
    try:
        pay_and_confirm(session, ap["location"], ap["rate"], ap["duration"], ap["unit"], ap["plate"],
                        ap["paymentAccountId"])
        ap["lastPayment"] = now.isoformat()
        ap["lastError"] = None
        session.log("success", "Renouvellement automatique : zone %s, %s" % (ap["location"], ap["plate"]))
    except Unconfirmed as e:
        # Never retry blindly: the payment may have gone through, retrying could pay twice.
        ap["enabled"] = False
        ap["lastError"] = suspended_message(e)
        session.log("error", ap["lastError"])
    except Exception as e:
        ap["lastError"] = friendly_error(e)
        session.log("error", "Renouvellement automatique échoué (zone %s) : %s" % (ap["location"], ap["lastError"]))


def autopilot_loop():
    while True:
        for session in list(SESSIONS.values()):
            for ap in list(session.autopilots.values()):
                if ap["enabled"]:
                    try:
                        run_autopilot(session, ap)
                    except Exception as e:
                        ap["lastError"] = friendly_error(e)
        time.sleep(60)


@app.on_event("startup")
def start_autopilot():
    if not HOSTED:  # a serverless deployment has no long-running process
        threading.Thread(target=autopilot_loop, daemon=True).start()


# --------------------------------------------------------------------------
# Hosted weekly renewals (Supabase + scheduler)
# --------------------------------------------------------------------------


def owner_id(username):
    """Stable id of a PayByPhone account that does not reveal the phone number."""
    return hmac.new(_subkey(_secrets()[0], "owner"), username.encode(), hashlib.sha256).hexdigest()


def normal_email(email):
    """The e-mail as one person's: lower case, without its +tag, nor dots for Gmail."""
    local, _, domain = (email or "").strip().lower().rpartition("@")
    local = local.split("+")[0]
    if domain in ("gmail.com", "googlemail.com"):
        local, domain = local.replace(".", ""), "gmail.com"
    return local + "@" + domain


def email_key(email):
    """Keyed fingerprint of an account's e-mail (one e-mail per account): nothing readable is kept."""
    return hmac.new(_subkey(_secrets()[0], "email"), normal_email(email).encode(), hashlib.sha256).hexdigest()


def email_taken(email, owner):
    """Another PayByBot account already uses this e-mail (online only; a failed lookup never blocks)."""
    if not HOSTED or not email or "@" not in email:
        return False
    try:
        other = store("account_email_owner", p_key=email_key(email))
    except Exception as e:
        log.warning("e-mail uniqueness check failed: %s", type(e).__name__)
        return False
    return bool(other) and other != owner


EMAIL_TAKEN = "Cette adresse e-mail est déjà utilisée par un autre compte PayByBot. Utilisez-en une autre."


def keep_email_key(owner, email):
    """Records the account's e-mail fingerprint (after the account is saved)."""
    if not HOSTED or not email or "@" not in email:
        return
    try:
        store("account_set_email_key", p_owner=owner, p_key=email_key(email))
    except Exception as e:
        log.warning("e-mail fingerprint not kept: %s", type(e).__name__)


def trial_keys(s, email=None):
    """Fingerprints of what identifies someone who already had the free month: the PayByPhone account, the sign-up
    e-mail (without its +tag, nor dots for Gmail) and the vehicles' plates. Keyed HMACs: nothing readable is kept."""
    key = _subkey(_secrets()[0], "trial")

    def mark(kind, value):
        return kind + ":" + hmac.new(key, value.encode(), hashlib.sha256).hexdigest()
    keys = [mark("o", s.username.strip())]
    if email and "@" in email:
        keys.append(mark("e", normal_email(email)))
    try:
        vehicles = s.call("get_vehicles") or []
    except Exception as e:
        log.warning("vehicles unreadable for the free month check: %s", str(e)[:200])
        vehicles = []
    keys += [mark("p", plate_key(v["licensePlate"])) for v in vehicles if v.get("licensePlate")]
    return list(dict.fromkeys(keys))


def earlier_trial(s, email=None):
    """When a free month already started for this account, e-mail or one of its vehicles (None: never)."""
    if not HOSTED or s.demo:
        return None
    try:
        return parse_dt(store("trial_first", p_keys=trial_keys(s, email)))
    except Exception as e:
        log.warning("free month check failed: %s", str(e)[:200])
        return None


def mark_trial(s, start, email=None):
    """Keeps the free month's start for this account, e-mail and vehicles: it survives the account's deletion."""
    if not HOSTED or s.demo or not start:
        return
    try:
        store("trial_mark", p_keys=trial_keys(s, email), p_start=start.isoformat())
    except Exception as e:
        log.warning("free month not recorded: %s", str(e)[:200])


# Word of mouth only: online, signing up needs the link of an existing user (?i=<code> on the site).
INVITE_ONLY = os.environ.get("PAYBYBOT_INVITE_ONLY", "").strip() == "1"


def invite_code(owner):
    """A user's invitation code: the start of their owner id (who invited, for later) signed by the server."""
    o = str(owner)[:8]
    return o + hmac.new(_subkey(_secrets()[0], "invite"), o.encode(), hashlib.sha256).hexdigest()[:6]


# One private link for everyone (PAYBYBOT_INVITE_CODE): the founder's, shared from person to person. Without it,
# each user has their own signed code.
SHARED_INVITE = os.environ.get("PAYBYBOT_INVITE_CODE", "").strip()


def valid_invite(code):
    code = str(code or "").strip()
    if SHARED_INVITE:
        return hmac.compare_digest(code, SHARED_INVITE)
    code = code.lower()
    return bool(re.fullmatch(r"[0-9a-f]{14}", code)) and hmac.compare_digest(invite_code(code[:8]), code)


def encrypt_credential(refresh_token):
    return _fernet("credential").encrypt(refresh_token.encode()).decode()


def decrypt_credential(value):
    return _fernet("credential").decrypt(value.encode()).decode()


def stored_refresh(owner):
    """The PayByPhone refresh token kept with this account's renewals, if any."""
    if not owner:
        return None
    try:
        value = store("renewal_get_credential", p_owner=owner)
        return decrypt_credential(value) if value else None
    except Exception as e:
        log.warning("stored PayByPhone token unreadable: %s", type(e).__name__)
        return None


def share_refresh(owner, refresh):
    """PayByPhone may replace the refresh token at each use: the account's renewals keep the newest one."""
    if not (owner and refresh):
        return
    try:
        store("renewal_put_credential", p_owner=owner, p_credential=encrypt_credential(refresh))
    except Exception as e:
        log.warning("could not store the new PayByPhone token: %s", type(e).__name__)


def refusal(e):
    """Why PayByPhone refused a token (status and error code only, never the token)."""
    if not isinstance(e, requests.HTTPError) or e.response is None:
        return type(e).__name__
    try:
        code = e.response.json().get("error")
    except Exception:
        code = None
    return "%s %s" % (e.response.status_code, code or "")


def bot_from_refresh(refresh, owner=None):
    """PayByPhone login without the password. The login cookie and the renewals each hold a refresh token, and
    using one may replace it: if this one is refused, the newest stored for the account is tried, and the token
    PayByPhone hands back is stored for all."""
    tried, error = set(), None
    for get in (lambda: refresh, lambda: stored_refresh(owner)):
        token = get()
        if not token or token in tried:
            continue
        tried.add(token)
        try:
            bot = Bot.from_refresh_token(token)
        except requests.HTTPError as e:
            log.warning("PayByPhone refresh token refused: %s", refusal(e))
            error = e
            continue
        if bot.refresh_token and bot.refresh_token != token:
            share_refresh(owner, bot.refresh_token)
        return bot
    raise error or ValueError("no PayByPhone refresh token")


RENEWAL_FIELDS = ("label", "plate", "location", "rate", "duration", "unit", "payment_account_id", "email", "days",
                  "start", "tz", "cmis_attested_at", "date_from", "date_to",
                  "bank_job", "bank_ends", "bank_deadline", "bank_remind", "bank_reminded", "bank_at", "refused_tries", "card_warned",
                  "card_stats", "card_hint", "advanced_until")


def encrypt_details(details):
    """Plate, zone, rate... are stored encrypted too: the database alone reveals nothing usable."""
    return _fernet("renewal").encrypt(json.dumps({k: details.get(k, "") for k in RENEWAL_FIELDS}).encode()).decode()


def with_details(row):
    """Database row (encrypted data) -> row with its details in clear."""
    return {**row, **json.loads(_fernet("renewal").decrypt(row["data"].encode()))}


ACCOUNT_FIELDS = ("email", "first_name", "zone", "trial_start", "trial_kept", "plan", "stripe_customer", "stripe_subscription",
                  "weekly_cents", "price_zone", "billed_weekly_cents", "weeklies", "billed_weeklies", "monthlies", "billed_monthlies", "suv_plates", "zone_found",
                  "vehicle_zones", "dunning", "check_mailed", "early_stops", "checkout_at", "chosen_plates", "email_keyed", "origin")
TRIAL_DAYS = 30  # one free month for every new account, from the day the offer is chosen (never at sign-up)


def trial_started(account):
    """The patch that starts the free month now, when the offer is chosen (nothing if it already started)."""
    if account.get("trial_start"):
        return {}
    return {"trial_start": datetime.now(timezone.utc).isoformat(), "trial_kept": True}


def load_account(s):
    """The PayByBot account of a session: e-mail given at sign-up and home zone added by hand."""
    if HOSTED and not s.demo:
        data = store("account_get", p_owner=owner_id(s.username))
        return json.loads(_fernet("account").decrypt(data.encode())) if data else {}
    return dict(s.account)


def has_account(s):
    """Signed up already: an account, or renewals stored before accounts existed."""
    if load_account(s):
        return True
    return bool(HOSTED and not s.demo and store("renewal_list", p_owner=owner_id(s.username)))


def account_by_owner(owner):
    """The stored account of an owner id, without a session (scheduler, e-mail links)."""
    data = store("account_get", p_owner=owner)
    return json.loads(_fernet("account").decrypt(data.encode())) if data else {}


def save_account_by_owner(owner, patch):
    account = {**account_by_owner(owner), **{k: v for k, v in patch.items() if k in ACCOUNT_FIELDS}}
    store("account_save", p_owner=owner, p_data=_fernet("account").encrypt(json.dumps(account).encode()).decode())
    if patch.get("email"):
        keep_email_key(owner, patch["email"])
    return account


def save_account(s, patch):
    account = {**load_account(s), **{k: v for k, v in patch.items() if k in ACCOUNT_FIELDS}}
    if HOSTED and not s.demo:
        store("account_save", p_owner=owner_id(s.username),
              p_data=_fernet("account").encrypt(json.dumps(account).encode()).decode())
        if patch.get("email"):
            keep_email_key(owner_id(s.username), patch["email"])
    else:
        s.account = account
    return account


def check_login_rate(request, username):
    """Hosted: refuse bursts of login attempts (password guessing through PayByBot)."""
    ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    keys = {"ip": hmac.new(_subkey(_secrets()[0], "rate"), ip.encode(), hashlib.sha256).hexdigest(),
            "user": owner_id(username.strip().lower())}
    for kind, limit in LOGIN_LIMITS:
        if not store("rate_hit", p_key=kind + ":" + keys[kind], p_window_seconds=900, p_max=limit):
            log.warning("login rate limit hit (%s)", kind)
            raise HTTPException(429, "Trop de tentatives de connexion. Réessayez dans 15 minutes.")


TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def turnstile_site_key():
    """Hosted, with both Cloudflare Turnstile keys set: sign-up and logins need a human check. Else ""."""
    site, secret = os.environ.get("TURNSTILE_SITE_KEY", "").strip(), os.environ.get("TURNSTILE_SECRET_KEY", "").strip()
    return site if HOSTED and site and secret else ""


def check_human(request, token):
    """Refuse the request unless Cloudflare confirms the Turnstile token (single use) came from a person."""
    if not turnstile_site_key():
        return
    if not token:
        raise HTTPException(400, "Vérification anti-robot manquante. Rechargez la page et réessayez.")
    ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    try:
        r = requests.post(TURNSTILE_VERIFY, timeout=10, data={
            "secret": os.environ["TURNSTILE_SECRET_KEY"].strip(), "response": token, **({"remoteip": ip} if ip else {})})
        result = r.json()
    except Exception as e:
        log.warning("human check unavailable: %s", type(e).__name__)
        raise HTTPException(503, "La vérification anti-robot ne répond pas. Réessayez dans un instant.")
    if not result.get("success"):
        log.warning("human check refused: %s", result.get("error-codes"))
        raise HTTPException(400, "La vérification anti-robot a échoué. Réessayez.")


def cron_authorized(request):
    """The scheduler sends a bearer token: Supabase's (checked by its SHA-256) or Vercel Cron's CRON_SECRET."""
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not token:
        return False
    expected_hash = os.environ.get("PAYBYBOT_CRON_TOKEN_SHA256", "")
    if expected_hash and hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), expected_hash):
        return True
    vercel_secret = os.environ.get("CRON_SECRET", "")
    return bool(vercel_secret) and hmac.compare_digest(token, vercel_secret)


def store(fn, **params):
    """Call one of the renewal_* database functions (see the Supabase migration)."""
    r = requests.post(
        os.environ["PAYBYBOT_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + fn,
        headers={"apikey": os.environ["PAYBYBOT_SUPABASE_KEY"], "Content-Type": "application/json"},
        json={"p_token": os.environ["PAYBYBOT_DB_TOKEN"], **params},
        timeout=15,
    )
    r.raise_for_status()
    return r.json() if r.content else None


def stored_to_autopilot(row):
    """Database row -> the shape the interface already uses for renewals."""
    row = with_details(row)
    return {
        "id": row["id"], "label": row.get("label") or "", "plate": row["plate"], "location": row["location"],
        "rate": row["rate"], "duration": fmt_qty(row["duration"]), "unit": row["unit"],
        "paymentAccountId": row["payment_account_id"], "enabled": row["enabled"],
        "lastCheck": row.get("last_check"), "lastPayment": row.get("last_payment"), "lastError": row.get("last_error"),
        "nextCheck": row.get("next_check"),
        "email": row.get("email") or "", "pausedFrom": row.get("paused_from"), "pausedUntil": row.get("paused_until"),
        "days": row.get("days") or None, "start": row.get("start") or None,
        "dateFrom": row.get("date_from") or None, "dateTo": row.get("date_to") or None,
        "validate": validate_token(row["owner"], row["id"]) if row.get("last_error") == BANK_WAIT else None,
    }


def with_next_ticket(ap):
    """Adds when the next ticket of a "precise days" renewal will be taken (for display)."""
    rule = rule_of(ap)
    nxt = rule and schedule.next_ticket(rule, datetime.now(timezone.utc), ap.get("pausedFrom"), ap.get("pausedUntil"))
    return {**ap, "nextTicket": nxt.astimezone(timezone.utc).isoformat() if nxt else None}


def utc_iso(dt):
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def early_stops(session, row):
    """Resident tickets of this car in this zone that ended before the end of their paid weeks: stopped by the user
    in PayByPhone (PayByBot is not told when it happens)."""
    found = []
    for x in session.call("get_past_sessions", limit=10) or []:
        if not (same_plate((x.get("vehicle") or {}).get("licensePlate"), row["plate"])
                and str(x.get("locationId")) == str(row["location"])
                and str((x.get("ratePolicy") or {}).get("ratePolicyId")) == str(row["rate"])):
            continue
        start, end = parse_dt(x.get("startTime")), parse_dt(x.get("expireTime"))
        if not (start and end):
            continue
        weeks = max(1, round((end - start) / WEEK))
        if abs((end - start) - weeks * WEEK) > timedelta(hours=2):
            found.append({"session": x.get("parkingSessionId"), "start": utc_iso(start), "end": utc_iso(end),
                          "paid_until": utc_iso(start + weeks * WEEK), "status": x.get("status")})
    return found


def keep_early_stops(session, row):
    """Keeps on the account each week stopped early (date, planned end, PayByPhone status): the proof that the
    user stopped it, should a week bought after be disputed. Never stops a renewal."""
    if not row.get("owner"):
        return
    try:
        stops = early_stops(session, row)
        if not stops:
            return
        known = account_by_owner(row["owner"]).get("early_stops") or []
        seen = {k.get("session") for k in known}
        new = [dict(x, plate=plate_key(row["plate"]), seen_at=utc_iso(datetime.now(timezone.utc)))
               for x in stops if x["session"] not in seen]
        if new:
            save_account_by_owner(row["owner"], {"early_stops": (known + new)[-20:]})
            log.info("renewal %s: %d week(s) stopped early in PayByPhone kept as proof (status %s)", row["id"],
                     len(new), sorted({str(x["status"]) for x in new}))
    except Exception as e:
        log.warning("early stops not checked: %s", str(e)[:200])


def process_renewal(row, refresh_token=None, activating=False, refused=False, validating=False):
    """Check one stored renewal and pay for it if no session is active. Never raises.
    validating: the card holder just asked to validate a payment their bank wants confirmed, so it is paid now."""
    now = datetime.now(timezone.utc)
    patch = {}
    try:
        row = with_details(row)
    except Exception as e:
        log.warning("renewal %s: unreadable details: %s", row.get("id"), e)
        store("renewal_update", p_id=row["id"], p_patch={"enabled": False, "last_error": RELOGIN})
        return "unreadable"
    previous_error = row.get("last_error")
    refused = refused or bool(previous_error)  # the last try failed: another card of the account goes first
    rule = rule_of(row)
    if rule:
        # Precise days: no PayByPhone login at all outside the ticket windows.
        due, next_check = schedule.decide(rule, now, row.get("paused_from"), row.get("paused_until"),
                                          row.get("last_payment"))
        if not due:
            store("renewal_update", p_id=row["id"],
                  p_patch={"next_check": utc_iso(next_check or now + timedelta(days=30))})
            return "paused" if paused_now(row.get("paused_from"), row.get("paused_until"), now) else "waiting"
    elif paused_now(row.get("paused_from"), row.get("paused_until"), now):
        # Check again when the pause ends, without even logging in to PayByPhone meanwhile.
        resume = parse_dt(row.get("paused_until")) or now + timedelta(hours=12)
        store("renewal_update", p_id=row["id"], p_patch={"next_check": utc_iso(resume)})
        return "paused"
    if row.get("owner") and not refresh_token:
        state = guarded_state(row["owner"])
        if state in BLOCKED_STATES:
            # Unpaid: the ticket running now stays valid, the next one is not paid. Checked again every
            # 2 hours, so the renewal resumes on its own once the subscription is paid.
            store("renewal_update", p_id=row["id"],
                  p_patch={"last_error": BLOCKED, "next_check": utc_iso(now + timedelta(hours=2))})
            if previous_error != BLOCKED and state == "trial_over":  # unpaid: the dunning e-mails say it
                notify_blocked(row, state)
            return "blocked"
    try:
        refresh = refresh_token or decrypt_credential(row["credential"])
        bot = bot_from_refresh(refresh, row.get("owner"))
    except Exception as e:
        if is_outage(e):  # PayByPhone blocked or down: not the user's login, tried again in 30 minutes
            log.warning("renewal %s: PayByPhone unreachable at login: %s", row["id"], str(e)[:200])
            store("renewal_update", p_id=row["id"], p_patch={"next_check": utc_iso(now + timedelta(minutes=30))})
            outage_hit()
            return "unreachable"
        log.warning("renewal %s: login with refresh token failed: %s", row["id"], str(e)[:200])
        store("renewal_update", p_id=row["id"],
              p_patch={"last_error": RELOGIN, "next_check": utc_iso(now + timedelta(hours=6))})
        if previous_error != RELOGIN:
            notify(row, "problem", message=RELOGIN)
        return "relogin"
    if bot.refresh_token and bot.refresh_token != refresh:
        patch["credential"] = encrypt_credential(bot.refresh_token)
    session = UserSession.for_bot(bot)
    outcome = "error"
    result, expire = None, None
    used_card, bank_asked = row.get("payment_account_id"), False
    active, may_advance = None, False  # may_advance: nothing covers the car and the client's card failed
    try:
        row = card_warned_row(session, row, now, patch)
        active = running_for(session, row["plate"])
        # Weekly renewal: the next week is added to the running ticket a day before it ends, so a refused payment
        # leaves a day to fix the card while the car is still covered. Not when a pause starts before the end.
        ticket = None if rule else extendable(active, row)
        ends = aware(covered_until(active))
        # A pause still to come or running (one already over does not stop extending the week any more).
        until = parse_dt(row.get("paused_until"))
        pause = parse_dt(row.get("paused_from")) if until is None or until > now else None
        # At 20:00 the day before the end; when activating, at once if PayByPhone already offers to extend.
        due = bool(ticket) and (now >= extension_time(ends) or ((activating or validating) and ends - now <= EARLY_RENEWAL))
        advanced_until = parse_dt(row.get("advanced_until"))
        if not active and advanced_until and advanced_until > now:
            # Covered by a ticket PayByBot advanced from its own account (not in the client's): nothing to pay yet.
            patch.update(next_check=utc_iso(advanced_until + timedelta(seconds=30)), last_error=None)
            outcome = "active"
        elif previous_error == BANK_WAIT and not validating:
            # Waiting on the card holder: paid only if the ticket moved, never tried again from here.
            if bank_validated(row, active):
                expire = covered_until(active)
                next_check = schedule.next_slot(rule, now) if rule else next_look(expire, now)
                patch.update(last_payment=utc_iso(now), last_error=None,
                             next_check=utc_iso(next_check or now + timedelta(days=30)))
                outcome = "paid"
            elif now >= parse_dt(row.get("bank_deadline")):
                patch.update(enabled=False, last_error=BANK_CHECK + " Renouvellement suspendu.")
                outcome = "unconfirmed"
                may_advance = not active
            else:
                outcome = "bank_wait"
                remind, deadline = parse_dt(row.get("bank_remind")), parse_dt(row.get("bank_deadline"))
                reminded = bool(row.get("bank_reminded"))
                if not reminded and now >= remind:
                    notify_bank(row)
                    patch["data"] = encrypt_details({**row, "bank_reminded": "1"})
                    reminded = True
                patch["next_check"] = utc_iso(bank_next_look(row, deadline if reminded else remind, now))
        elif ticket and due and not (pause and pause <= ends):
            card = check_payable(session, row["location"], row["rate"], row["plate"], row["payment_account_id"],
                                 avoid=refused)
            used_card = card
            try:
                result, found = extend_and_confirm(session, ticket, row, card)
            except Unconfirmed:
                raise
            except Exception as e:
                if "Quote error" not in str(e) and "No quote returned" not in str(e):
                    raise
                # PayByPhone does not extend this ticket (longest stay reached, for one): buy the next week
                # when it ends, as before.
                log.info("renewal %s: extension refused, next week bought at the end: %s", row["id"], str(e)[:300])
                found = None
            if found:
                expire = covered_until(found)
                patch.update(last_payment=utc_iso(now), next_check=utc_iso(next_look(expire, now)),
                             last_error=None)
                keep_other_card(row, card, patch)
                outcome = "paid"
            else:
                patch.update(next_check=utc_iso(ends + timedelta(seconds=30)), last_error=None)
                outcome = "active"
        elif active:
            expire = covered_until(active)
            next_check = expire + timedelta(seconds=30)
            warning = None
            if rule:  # covered already: never pay twice, look again when it ends or at the next window
                next_check = schedule.decide(rule, now, None, None, row.get("last_payment"), expire)[1]
            elif ticket and not (pause and pause <= ends):  # come back before the end to look at the card, then extend
                next_check = next_look(ends, now)
                warning = checked_ahead(session, row, ends, now)
                if warning:  # told now, while there is time; looked at again in case it gets fixed
                    next_check = min(now + CHECK_AGAIN, extension_time(ends))
            patch.update(next_check=utc_iso(next_check or now + timedelta(days=30)), last_error=warning)
            outcome = "active"
        else:
            keep_early_stops(session, row)  # a week stopped in PayByPhone before its end: kept as proof
            card = check_payable(session, row["location"], row["rate"], row["plate"], row["payment_account_id"],
                                 avoid=refused)
            used_card = card
            result, found = pay_and_confirm(session, row["location"], row["rate"], fmt_qty(row["duration"]),
                                            row["unit"], row["plate"], card)
            expire = covered_until(found)
            next_check = schedule.next_slot(rule, now) if rule else next_look(expire, now)
            patch.update(last_payment=utc_iso(now), next_check=utc_iso(next_check or now + timedelta(days=30)),
                         last_error=None)
            keep_other_card(row, card, patch)
            outcome = "paid"
    except BankCheck as e:
        # The card holder is told at once, and the payment is theirs to validate until the car is no longer covered.
        patch.update(bank_wait_patch(session, row, e.job_id, active, now, validating))
        bank_asked = not validating
        outcome = "bank_wait"
    except Unconfirmed:
        patch.update(refused_patch(row, UNCONFIRMED, previous_error, now, running_end(session, row)))
        outcome = "unconfirmed"
    except NotPayable as e:  # nothing was paid: tell the user, look again in an hour
        patch.update(last_error=str(e), next_check=utc_iso(now + RETRY_AFTER))
        outcome = "not_payable"
        may_advance = not active and (str(e) == NO_CARD or str(e).startswith(CARD_EXPIRED.split("(")[0]))
    except Exception as e:
        if "VehicleAlreadyParked" in str(e):  # a ticket PayByPhone knows of but did not list: wait, not an error
            patch.update(last_error=None, next_check=utc_iso(now + timedelta(minutes=30)))
            outcome = "active"
        elif "Payment job failed" in str(e):
            patch.update(refused_patch(row, friendly_error(e), previous_error, now, running_end(session, row)))
            outcome = "refused"
            may_advance = not active
        else:
            patch.update(last_error=friendly_error(e), next_check=utc_iso(now + timedelta(minutes=30)))
            if is_outage(e):
                outage_hit()
    if may_advance and not rule:  # resident renewals: the owner's backup account pays, the client is billed
        advanced = advance(row, now)
        if advanced:
            result, found = advanced
            expire = aware(covered_until(found))
            details = json.loads(_fernet("renewal").decrypt(patch["data"].encode())) if patch.get("data") else row
            patch.pop("enabled", None)
            patch.update(last_error=None, last_payment=utc_iso(now), next_check=utc_iso(expire + timedelta(seconds=30)),
                         data=encrypt_details({**details, "advanced_until": utc_iso(expire), "refused_tries": 0,
                                               "bank_job": "", "bank_deadline": ""}))
            outcome = "advanced"
    if outcome in ("paid", "active", "advanced"):
        outage_clear()
    counted = "bank" if bank_asked else {"paid": "paid", "refused": "refused", "unconfirmed": "refused",
                                         "advanced": "refused"}.get(outcome)
    if counted:
        count_card(session, row, patch, used_card, counted)
    log.info("renewal %s zone=%s plate=%s: %s", row["id"], row["location"], row["plate"][:2] + "***", outcome)
    store("renewal_update", p_id=row["id"], p_patch=patch)
    if outcome == "paid":
        notify(row, "paid", cost=(result or {}).get("cost"), expire=expire,
               next=schedule.next_ticket(rule, now, row.get("paused_from"), row.get("paused_until")) if rule else None)
    elif outcome == "advanced":
        notify(row, "advanced", cost=(result or {}).get("cost"), expire=expire)
    elif patch.get("last_error") and patch["last_error"] != previous_error:
        notify(row, "problem", message=patch["last_error"], suspended=patch.get("enabled") is False)
    return outcome


CHECK_AHEAD = timedelta(days=2)  # the card and the rate are looked at this long before the payment, nothing paid
CHECK_AGAIN = timedelta(hours=6)  # once a problem is told: enough to clear it soon after it is fixed
REFUSED_AGAIN = (timedelta(hours=1), timedelta(hours=4), timedelta(hours=8))  # enough time for money or a new card, few
# enough tries for the bank not to take it for an attack; with another card first when the account has one
CARD_WARN_DAYS = (7, 30)


def next_look(ends, now):
    """When a weekly renewal comes back: two days before paying, then to pay."""
    pay = extension_time(ends)
    return pay - CHECK_AHEAD if now < pay - CHECK_AHEAD else pay


def checked_ahead(session, row, ends, now):
    """Within the two days before paying: what would stop the payment (nothing is paid), or None."""
    pay = extension_time(ends)
    if not pay - CHECK_AHEAD <= now < pay:
        return None
    try:
        check_payable(session, row["location"], row["rate"], row["plate"], row["payment_account_id"])
    except NotPayable as e:
        return str(e)
    except Exception as e:
        log.info("renewal %s: not checked ahead: %s", row.get("id"), type(e).__name__)
    return None


def second_card_hint(session, details, counts):
    """Once, when the bank keeps asking on the account's only card: another card gives the payment a second chance.
    True if told."""
    if counts.get("bank", 0) < 2 or details.get("card_hint") or not details.get("email"):
        return False
    cards = [p for p in normalize_accounts(session.call("get_payment_accounts") or {}) if p["kind"] == "card" and not p["expired"]]
    if len(cards) != 1:
        return False
    send_email(details["email"], "Votre banque demande souvent une validation", "Une seconde carte peut aider",
               ["Votre banque a demandé plusieurs fois de valider les paiements de votre stationnement.",
                "Si vous avez une autre carte, ajoutez-la dans l'application PayByPhone : PayByBot pourra l'essayer si "
                "un paiement n'aboutit pas avec la première."],
               ("Ouvrir PayByBot", APP_URL))
    return True


def count_card(session, row, patch, card, what):
    """What happened to a payment, per card of the renewal (stored encrypted with it, gone with it). Never stops it."""
    try:
        details = json.loads(_fernet("renewal").decrypt(patch["data"].encode())) if patch.get("data") else row
        stats = dict(details.get("card_stats") or {})
        counts = dict(stats.get(card) or {})
        counts[what] = counts.get(what, 0) + 1
        stats[card] = counts
        hint = second_card_hint(session, details, counts)
        patch["data"] = encrypt_details({**details, "card_stats": stats, "card_hint": details.get("card_hint") or ("1" if hint else "")})
    except Exception as e:
        log.info("renewal %s: not counted: %s", row.get("id"), type(e).__name__)


def keep_other_card(row, card, patch):
    if card != row["payment_account_id"]:  # paid with another card: it becomes the renewal's card
        patch["data"] = encrypt_details({**row, "payment_account_id": card})
        log.info("renewal %s: now paid with another card of the account", row["id"])


def rebill_backup(row, result, now=None):
    """A ticket PayByBot advanced: add its cost to the client's next Stripe invoice, with its date. A yearly client
    has the advances billed every month rather than with the next yearly invoice."""
    if not os.environ.get("STRIPE_SECRET_KEY"):
        return
    account = account_by_owner(row.get("owner"))
    customer = account.get("stripe_customer")
    cost = (result or {}).get("cost") or {}
    amount = cost.get("amount")
    if not customer or not amount:
        return
    day = (now or datetime.now(timezone.utc)).astimezone(PARIS)
    try:
        stripe("POST", "invoiceitems", customer=customer, amount=round(float(amount) * 100),
               currency=(cost.get("currency") or "EUR").lower(),
               description="Stationnement du %d %s %d avancé par PayByBot"
                           % (day.day, MONTH_NAMES[day.month - 1], day.year))
        if account.get("plan") == "yearly" and account.get("stripe_subscription"):
            stripe("POST", "subscriptions/" + account["stripe_subscription"],
                   **{"pending_invoice_item_interval[interval]": "month"})
    except Exception as e:
        log.warning("renewal %s: backup rebill not added: %s", row.get("id"), str(e)[:150])


BACKUP_WEEKLY_CAP_CENTS = 30000  # at most this much advanced per week, for all clients together


def backup_ready():
    """The owner connected a backup PayByPhone account on the admin page."""
    try:
        return bool((store("backup_account_get") or {}).get("credential"))
    except Exception:
        return False


def advance(row, now):
    """The client's card failed and nothing covers the car: the owner's backup PayByPhone account pays the ticket for
    the client's plate, at the client's rate, and the client is billed for it. (result, ticket) or None."""
    cents = None
    try:
        backup = store("backup_account_get") or {}
        if not backup.get("credential"):
            return None
        if billing_state(account_by_owner(row["owner"]), row["owner"]) != "ok":  # an unpaid client gets no advance
            return None
        refresh = decrypt_credential(backup["credential"])
        bot = Bot.from_refresh_token(refresh)
        if bot.refresh_token and bot.refresh_token != refresh:  # PayByPhone may hand a new one: kept for next time
            store("backup_account_set", p_credential=encrypt_credential(bot.refresh_token), p_label=backup.get("label"))
        session = UserSession.for_bot(bot)
        card = check_payable(session, row["location"], row["rate"], row["plate"], None)
        quote = session.call("_create_quote", locationId=row["location"], ratePolicyId=str(row["rate"]),
                             durationQuantity=fmt_qty(row["duration"]), durationTimeUnit=row["unit"],
                             licensePlate=row["plate"], paymentAccountId=card)
        cents = round(float(quote["cost"]["amount"]) * 100)
        if not store("backup_spend", p_cents=cents, p_cap=BACKUP_WEEKLY_CAP_CENTS):
            log.warning("renewal %s: not advanced, weekly cap reached", row.get("id"))
            return None
        result, found = pay_and_confirm(session, row["location"], row["rate"], fmt_qty(row["duration"]), row["unit"],
                                        row["plate"], card)
    except Exception as e:
        log.warning("renewal %s: not advanced: %s", row.get("id"), str(e)[:200])
        if cents and not isinstance(e, Unconfirmed):  # refused for sure: the week's budget is given back
            try:
                store("backup_spend", p_cents=-cents, p_cap=BACKUP_WEEKLY_CAP_CENTS)
            except Exception:
                pass
        return None
    rebill_backup(row, result, now)
    return result, found


def running_end(session, row):
    """The end of the running ticket, None if none or unreadable."""
    try:
        active = running_for(session, row["plate"])
        return aware(covered_until(active)) if active else None
    except Exception:
        return None


def refused_patch(row, message, previous_error, now, ends):
    """A payment refused or not confirmed: tried again later and later, the running ticket being looked at first, so
    one that went through after all is never paid twice. The last try comes before the car stops being covered.
    After all of them: suspended."""
    tries = int(row.get("refused_tries") or 0) if previous_error == message else 0
    if tries >= len(REFUSED_AGAIN):
        return {"enabled": False, "last_error": message + " Renouvellement suspendu."}
    again = now + REFUSED_AGAIN[tries]
    if ends and now + timedelta(minutes=30) < ends - timedelta(minutes=30) < again:
        again = ends - timedelta(minutes=30)
    return {"last_error": message, "next_check": utc_iso(again), "data": encrypt_details({**row, "refused_tries": tries + 1})}


def warn_card_ending(session, row, now):
    """An e-mail 30 then 7 days before the account's last valid card ends, once each. What was told, or None."""
    cards = [p for p in normalize_accounts(session.call("get_payment_accounts") or {}, now) if p["kind"] == "card"]
    valid = [p for p in cards if not p["expired"]]
    if not valid or not row.get("email") or any(not p["validUntil"] for p in valid):
        return None
    last = max(valid, key=lambda p: p["validUntil"])
    days = (parse_dt(last["validUntil"]) - now).days
    within = next((d for d in CARD_WARN_DAYS if days <= d), None)
    mark = "%s:%s" % (last["label"].split("—")[-1].strip(), within)
    if within is None or mark == row.get("card_warned"):
        return None
    send_email(row["email"], "Votre carte bancaire expire bientôt", "Votre carte expire bientôt",
               ["La carte bancaire de votre compte PayByPhone arrive à expiration (%s)."
                % last["label"].split("—")[-1].strip(),
                "Ajoutez votre nouvelle carte dans l'application PayByPhone avant cette date : "
                "sans carte valable, votre renouvellement ne pourra plus payer."],
               ("Ouvrir PayByBot", APP_URL))
    return mark


def card_warned_row(session, row, now, patch):
    """The row, marked once the e-mail is sent. A failure here never stops a renewal."""
    try:
        mark = warn_card_ending(session, row, now)
    except Exception as e:
        log.info("renewal %s: card end not read: %s", row.get("id"), type(e).__name__)
        return row
    if not mark:
        return row
    row = {**row, "card_warned": mark}
    patch["data"] = encrypt_details(row)
    return row


def bank_validated(row, active):
    """The validation went through: a ticket appeared, or the running one now ends later than when it was asked."""
    if not active:
        return False
    before = parse_dt(row.get("bank_ends"))
    return before is None or aware(covered_until(active)) > before


BANK_HOPS = 4
BANK_TIMEOUT = 8


class BankAutoForm(HTMLParser):
    """Reads a page's first form: where it goes, its hidden fields, and whether anything in it is for a person."""

    def __init__(self):
        super().__init__()
        self.action, self.method, self.fields, self.for_a_person = None, "", {}, False
        self.inside = self.done = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form" and not self.done and self.action is None:
            self.action, self.method, self.inside = attrs.get("action") or "", (attrs.get("method") or "get").lower(), True
        elif self.inside and tag == "input" and (attrs.get("type") or "text").lower() == "hidden":
            if attrs.get("name"):
                self.fields[attrs["name"]] = attrs.get("value") or ""
        elif self.inside and tag in ("input", "button", "select", "textarea"):
            self.for_a_person = True

    def handle_endtag(self, tag):
        if tag == "form" and self.inside:
            self.inside, self.done = False, True


def bank_auto_form(html):
    """(where, fields) of a form the page sends by itself, else None: never what a card holder would fill or choose."""
    if ".submit()" not in html:
        return None
    form = BankAutoForm()
    form.feed(html)
    if not form.action or form.method != "post" or form.for_a_person:
        return None
    return form.action, form.fields


def open_bank_page(page):
    """Opens the page of a payment waiting on the bank, as a browser would, so that the bank can alert its client's
    phone. Validates nothing and states what it is (no invented browser data); logs what answered, never the content."""
    html = base64.b64decode(page["html"]).decode("utf-8", "replace") if page.get("html") else ""
    form = bank_auto_form(html)
    where, fields = page.get("url"), None
    if not where and form:
        where, fields = form
    if not where:
        log.info("bank page: nothing to open by itself")
        return
    http = requests.Session()
    http.headers["User-Agent"] = "PayByBot"
    for hop in range(BANK_HOPS):
        if urlsplit(where).scheme != "https":
            log.info("bank page %s: not https", hop)
            return
        answer = (http.post(where, data=fields, timeout=BANK_TIMEOUT) if fields is not None
                  else http.get(where, timeout=BANK_TIMEOUT))
        log.info("bank page %s: host=%s status=%s script=%s", hop, urlsplit(answer.url).hostname, answer.status_code,
                 "<script" in answer.text.lower())
        form = bank_auto_form(answer.text)
        if not form:
            return
        where, fields = urljoin(answer.url, form[0]), form[1]


HIDDEN_LOOKS = 4


def open_hidden_page(hidden):
    """As PayByPhone gives it: a link, a page, or a base64 page."""
    if hidden.startswith("https://"):
        open_bank_page({"url": hidden})
    else:
        open_bank_page({"html": base64.b64encode(hidden.encode()).decode() if "<" in hidden else hidden})


def past_hidden_step(session, job_id, page):
    """The bank's hidden page, which nobody sees and the card holder could not open: opened once, then a few looks
    for the page they validate, which only comes after it."""
    if not page or not page.get("hidden"):
        return page
    open_hidden_page(page["hidden"])
    for _ in range(HIDDEN_LOOKS):
        time.sleep(3)
        page = session.call("get_job_challenge", job_id)
        log.info("bank hidden step passed: %s", not page.get("hidden"))
        if not page.get("hidden"):
            break
    return page


def read_bank_page(session, job_id, opening):
    """What PayByPhone gives (never its content): the page may be a link or a whole page. Opened unless the card holder
    is opening it. A failure here changes nothing to the payment."""
    try:
        page = session.call("get_job_challenge", job_id) if job_id else None
        log.info("bank challenge: hidden=%s url=%s html=%s", bool((page or {}).get("hidden")),
                 bool((page or {}).get("url")), len((page or {}).get("html") or ""))
        page = past_hidden_step(session, job_id, page)
        if page and page.get("pending") and opening and not page.get("hidden"):
            open_bank_page(page)
    except Exception as e:
        log.info("bank challenge unreadable: %s", type(e).__name__)


BANK_LOOK = timedelta(minutes=10)  # validated in the bank's own app, PayByBot is not told: it looks for the new ticket
BANK_LOOK_FOR = timedelta(hours=1)  # the bank's page does not last longer than this


def bank_next_look(row, planned, now):
    asked = parse_dt(row.get("bank_at")) if row.get("bank_at") else None
    return min(planned, now + BANK_LOOK) if asked and now - asked < BANK_LOOK_FOR else planned


def bank_wait_patch(session, row, job_id, active, now, validating):
    """The renewal's state while the bank waits for its card holder; asked again by them, the first deadline stays."""
    ends = aware(covered_until(active)) if active else None
    # No ticket running: with a backup account, the ticket is advanced once the bank's page has expired.
    deadline = ends or now + (BANK_LOOK_FOR if backup_ready() else BANK_WAIT_DAY)
    remind = max(now + timedelta(minutes=30), deadline - BANK_REMIND) if ends else now + BANK_REMIND
    details = {"bank_job": job_id or "", "bank_ends": utc_iso(ends) if ends else "", "bank_deadline": utc_iso(deadline),
               "bank_remind": utc_iso(remind), "bank_reminded": "", "bank_at": utc_iso(now)}
    if validating:
        details.update(bank_deadline=row.get("bank_deadline") or details["bank_deadline"],
                       bank_remind=row.get("bank_remind") or details["bank_remind"],
                       bank_reminded=row.get("bank_reminded") or "", bank_at=row.get("bank_at") or details["bank_at"])
    read_bank_page(session, job_id, opening=not validating)
    return {"last_error": BANK_WAIT, "next_check": utc_iso(now + timedelta(minutes=15) if validating else min(remind, now + BANK_LOOK)),
            "data": encrypt_details({**row, **details})}


CLAIM_PER_RUN = 4  # renewals handled side by side at each scheduler run (every 5 minutes)


@app.api_route("/api/cron/renew", methods=["GET", "POST"])
def cron_renew(request: Request):
    """Called every few minutes by the scheduler. Only acts on renewals that are due."""
    if not HOSTED:
        raise HTTPException(404)
    if not cron_authorized(request):
        raise HTTPException(401, "Unauthorized")
    # Side by side, so a slow one (a payment to confirm can take a minute) never pushes the others past the
    # function's time limit; one failing never stops the others.
    rows = store("renewal_claim_due", p_limit=CLAIM_PER_RUN) or []

    def safe(row):
        try:
            return process_renewal(row)
        except Exception as e:
            log.warning("renewal %s not processed: %s", row.get("id"), type(e).__name__)
            return "error"
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(safe, rows))
    # Once an hour (the scheduler calls every 5 minutes): the e-mails of the grace week after a refused charge.
    dunned = run_dunning() if datetime.now(timezone.utc).minute < 5 else None
    check_capacity()
    return {"processed": len(results), "outcomes": results, "dunning": dunned, "probe": run_probe()}


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


EMAIL_PATTERN = r"^$|^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$"

# The common providers and their domains (None: any .com or country domain), to catch a slip of the finger
# (gmail.comm, gmial.com). Same list and rules as web/src/lib/validate.ts.
EMAIL_PROVIDERS = {
    "gmail": ["gmail.com"], "googlemail": ["googlemail.com"], "icloud": ["icloud.com"], "laposte": ["laposte.net"],
    "orange": ["orange.fr"], "wanadoo": ["wanadoo.fr"], "free": ["free.fr"], "sfr": ["sfr.fr"], "neuf": ["neuf.fr"],
    "bbox": ["bbox.fr"], "protonmail": ["protonmail.com", "protonmail.ch"],
    "hotmail": None, "outlook": None, "live": None, "yahoo": None,
}
ANY_COUNTRY = re.compile(r"^(com|(co\.|com\.)?[a-z]{2})$")


def edit_distance(a, b):
    """Damerau-Levenshtein distance (a swap of two letters counts as one)."""
    d = [[(j if not i else i if not j else 0) for j in range(len(b) + 1)] for i in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def domain_fix(domain):
    """The domain the person most likely meant when theirs is a typo of a common provider's, else None."""
    host = domain.lower()
    label, _, rest = host.partition(".")
    if not label or not rest:
        return None
    if label in EMAIL_PROVIDERS:
        provider = label
    elif len(label) >= 5 and label != "email":
        provider = next((p for p in EMAIL_PROVIDERS if len(p) >= 5 and edit_distance(label, p) == 1), None)
    else:
        provider = None
    if not provider:
        return None
    domains = EMAIL_PROVIDERS[provider]
    if domains:
        if host in domains:
            return None
        return next((d for d in domains if edit_distance(d.partition(".")[2], rest) <= 2), domains[0])
    if provider == label and ANY_COUNTRY.match(rest):
        return None
    end = rest if ANY_COUNTRY.match(rest) else "fr" if edit_distance(rest, "fr") < edit_distance(rest, "com") else "com"
    return provider + "." + end


def email_problem(email):
    """What is wrong with an e-mail (shown to the person), or None when it looks right."""
    value = (email or "").strip()
    if not re.fullmatch(EMAIL_PATTERN[3:], value):
        return "Adresse e-mail invalide : vérifiez-la (exemple : prenom.nom@gmail.com)."
    local, _, domain = value.rpartition("@")
    fix = domain_fix(domain)
    return "Adresse e-mail invalide : vouliez-vous dire %s@%s ?" % (local, fix) if fix else None


def check_email(email):
    """Refuses an e-mail that cannot be right (an empty one is left to the caller)."""
    if (email or "").strip() and email_problem(email):
        raise HTTPException(400, email_problem(email))


def french_phone(username):
    """+33 and the 9 digits of a French number typed in any usual way, or None when it is not one."""
    digits = re.sub(r"[\s.\-()]", "", username or "")
    for prefix in ("+33", "0033"):
        if digits.startswith(prefix):
            digits = digits[len(prefix):]
            break
    else:
        if digits.startswith("+"):
            return None
        if len(digits) == 10 and digits.startswith("0"):
            digits = digits[1:]
    return "+33" + digits if re.fullmatch(r"[1-9]\d{8}", digits) else None


class Login(BaseModel):
    username: str = Field(max_length=120)
    password: str = Field(max_length=200)
    accepted: bool = False  # terms of use and privacy policy
    signup: bool = False
    remember: bool = False  # "Se souvenir de moi"
    email: str = Field(default="", max_length=254, pattern=EMAIL_PATTERN)  # required at sign-up
    zone: str = Field(default="", pattern=r"^$|^\w{3,10}$")  # home zone, asked at sign-up
    turnstile: str = Field(default="", max_length=2048)  # Cloudflare's human check token (hosted)
    invite: str = Field(default="", max_length=40)  # the inviting user's code (sign-up, invite-only)
    source: str = Field(default="", max_length=20)  # the link's tag (?s=): "acces" when asked by e-mail, no referral


class AccountPatch(BaseModel):
    email: str | None = Field(default=None, max_length=254, pattern=EMAIL_PATTERN)
    zone: str | None = Field(default=None, pattern=r"^$|^\w{3,10}$")


class Parking(BaseModel):
    location: str = Field(max_length=20)
    rate: str = Field(max_length=40)
    duration: float = Field(gt=0, le=10000)
    unit: str = Field(pattern="^(Days|Hours|Minutes)$")
    plate: str = Field(max_length=20)
    paymentAccountId: str = Field(max_length=80)


class Extension(Parking):
    sessionId: str = Field(max_length=80)


class Autopilot(Parking):
    label: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=254, pattern=EMAIL_PATTERN)
    # Precise days (0 = Monday ... 5 = Saturday; Sundays are free) and the Paris time the ticket is taken.
    # No days: the continuous weekly renewal.
    days: list[Annotated[int, Field(ge=0, le=6)]] | None = Field(default=None, min_length=1, max_length=7)
    tz: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+){0,2}$")
    start: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    # Chosen on the calendar: the first and last day (included) the tickets are taken; one day when both are equal.
    dateFrom: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    dateTo: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    # « Je suis titulaire de la carte CMI-S »: ticked for the Handi ticket, kept with the renewal as proof.
    cmis: bool = False


class Pause(BaseModel):
    start: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")  # first paused day (Paris)
    end: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")  # last paused day; None = no end yet


class EmailChange(BaseModel):
    email: str = Field(default="", max_length=254, pattern=EMAIL_PATTERN)


@app.post("/api/login")
def login(body: Login, request: Request, response: Response):
    demo = body.username.strip().lower() == "demo"
    if demo and HOSTED:  # the demo account is for local use only, not on the public site
        raise HTTPException(404, "La démo n'est pas disponible.")
    masked = body.username.strip()[:4] + "***"
    if body.signup and not demo and not body.email.strip():
        raise HTTPException(400, "Indiquez votre adresse e-mail.")
    if body.signup and not demo:
        check_email(body.email)
        if "@" not in body.username and not french_phone(body.username):
            raise HTTPException(400, "Numéro invalide : un numéro français à 10 chiffres (exemple : 06 12 34 56 78).")
    if body.signup and not demo and INVITE_ONLY and not valid_invite(body.invite):
        raise HTTPException(403, "PayByBot est sur invitation : demandez son lien à un proche qui l'utilise déjà.")
    if HOSTED and not demo:
        if not body.accepted:
            raise HTTPException(400, "Acceptez les conditions d'utilisation et la politique de confidentialité.")
        check_human(request, body.turnstile)
        check_login_rate(request, body.username)
    try:
        session = UserSession(body.username.strip(), body.password, demo=demo)
    except Exception as e:
        log.warning("login failed for %s: %s", masked, e)
        raise HTTPException(400, friendly_error(e))
    log.info("login ok for %s (%s)", masked, "demo" if demo else "PayByPhone account %s***" % session.username[:5])
    session.remember = body.remember
    if not demo and (body.signup or HOSTED):
        exists = guarded(lambda: has_account(session))
        if body.signup and exists:
            log.info("sign-up refused: account already exists for %s", masked)
            raise HTTPException(409, "Un compte PayByBot existe déjà pour ce compte PayByPhone.")
        if not body.signup and not exists and not is_admin(session):  # online, logging in needs a sign-up first
            log.info("login refused: no account yet for %s", masked)
            raise HTTPException(404, "Aucun compte PayByBot pour ce compte PayByPhone.")
    if body.signup and not demo:  # the account is created once the e-mail is confirmed with a code
        # No card saved on PayByPhone does not stop the sign-up: the account then asks for one, full screen. No
        # resident rate needed any more: non-residents take visitor or Handi tickets on chosen days.
        zone = guarded(lambda: resident_home_zone(session))  # the resident zone when there is one, else None
        if email_taken(body.email.strip(), owner_id(session.username)):  # one e-mail per PayByBot account
            log.info("sign-up refused: e-mail already used by another account")
            raise HTTPException(400, EMAIL_TAKEN)
        return start_verification(response, session, body.email.strip(), zone, source=body.source)
    if HOSTED:
        token = seal(session)
        refresh = getattr(session.bot, "refresh_token", None)
        if not demo and refresh:
            try:  # renewals that lost their PayByPhone connection start again with this one
                store("renewal_set_credential", p_owner=owner_id(session.username),
                      p_credential=encrypt_credential(refresh))
            except Exception as e:
                log.warning("could not refresh stored renewals: %s", e)
    else:
        token = seal(session) if body.remember else secrets.token_urlsafe(32)
        SESSIONS[token] = session
    if body.email.strip() or body.zone.strip():
        try:
            save_account(session, {k: v for k, v in (("email", body.email.strip()), ("zone", body.zone.strip())) if v})
            if HOSTED and demo:
                token = seal(session)  # the demo account lives in the cookie
        except Exception as e:
            log.warning("could not save the account e-mail: %s", e)
    set_session_cookie(response, token, body.remember)
    log.info("PayByPhone token fields: %s", sorted(token_claims(session)))  # names only, never values
    remember_name(session)
    record_activity("Connexion", session)
    return {"username": session.username, "demo": demo, "hosted": HOSTED, "firstName": first_name(session)}


class SignupCheck(BaseModel):
    username: str = Field(max_length=120)


@app.post("/api/signup/check")
def signup_check(body: SignupCheck, request: Request):
    """Tell the sign-up page, as soon as the number is typed, that this account is already signed up.
    Limited per device, since it reveals whether a number uses PayByBot."""
    if not HOSTED:
        return {"exists": False}
    ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    key = hmac.new(_subkey(_secrets()[0], "rate"), ip.encode(), hashlib.sha256).hexdigest()
    if not store("rate_hit", p_key="check:" + key, p_window_seconds=900, p_max=20):
        return {"exists": False}  # too many checks: say nothing, sign-up still refuses at the end

    def exists():
        for candidate in login_candidates(body.username)[:3]:
            owner = owner_id(candidate)
            if store("account_get", p_owner=owner) or store("renewal_list", p_owner=owner):
                return True
        return False

    return {"exists": guarded(exists)}


# --------------------------------------------------------------------------
# Sign-up: the e-mail is confirmed with a 6-digit code before the account exists
# --------------------------------------------------------------------------

PENDING_COOKIE = "pbb_pending"
CODE_TTL = 600  # seconds
CODE_TRIES = 5  # wrong codes before a new one is needed
PENDING = {}  # local app: token -> sign-up waiting for its code (hosted: sealed in the cookie)


def code_hash(code, email):
    key = _subkey(_secrets()[0], "code") if HOSTED else PENDING_KEY
    return hmac.new(key, ("%s:%s" % (code, email.lower())).encode(), hashlib.sha256).hexdigest()


PENDING_KEY = secrets.token_bytes(32)


def mask_email(email):
    name, _, domain = email.partition("@")
    return "%s•••@%s" % (name[:2], domain)


def send_code(email, code):
    sent = send_email(email, "Votre code PayByBot : %s" % code, "Votre code de vérification",
                      ["Saisissez ce code sur PayByBot pour finir votre inscription :",
                       "Il est valable 10 minutes. Ne le communiquez à personne."],
                      code="%s %s" % (code[:3], code[3:]),
                      footer="Vous recevez cet e-mail parce que cette adresse a été indiquée pour créer un compte "
                             "PayByBot. Si ce n'est pas vous, ignorez-le : aucun compte ne sera créé.")
    if not sent:
        if HOSTED:
            raise HTTPException(502, "L'e-mail n'a pas pu être envoyé. Vérifiez l'adresse et réessayez.")
        log.warning("local app without e-mail sending: verification code %s", code)  # local only, never online


# Where a new account came from: a user's link (word of mouth) or the link asked by e-mail on the home page.
ORIGIN_TEXT = {"parrainage": "parrainage", "sans_parrainage": "sans parrainage (lien demandé par e-mail)"}


def signup_origin(source):
    return "sans_parrainage" if source == "acces" else "parrainage"


def start_verification(response, session, email, zone, pending=None, source=""):
    code = "%06d" % secrets.randbelow(10 ** 6)
    if pending is None:
        pending = {"email": email, "zone": zone, "src": source}
        if HOSTED:
            pending["s"] = seal(session)
        else:
            pending["t"] = secrets.token_urlsafe(32)
    pending.update(h=code_hash(code, pending["email"]), exp=int(time.time()) + CODE_TTL, sent=int(time.time()))
    if HOSTED:
        value = _fernet("pending").encrypt(json.dumps(pending).encode()).decode()
    else:
        PENDING[pending["t"]] = {**pending, "session": session, "tries": 0}
        value = pending["t"]
    send_code(pending["email"], code)
    response.set_cookie(PENDING_COOKIE, value, httponly=True, samesite="strict", secure=HOSTED, path="/api/signup",
                        max_age=CODE_TTL)
    log.info("sign-up code sent")
    return {"pending": True, "email": mask_email(pending["email"])}


def read_pending(value):
    """The sign-up waiting for its code, and its PayByPhone session."""
    try:
        if HOSTED:
            pending = json.loads(_fernet("pending").decrypt((value or "").encode(), ttl=CODE_TTL + 60))
            session = UserSession.from_state(json.loads(_fernet().decrypt(pending["s"].encode())))
        else:
            pending = PENDING[value or ""]
            session = pending["session"]
    except Exception:
        raise HTTPException(410, "Ce code a expiré. Recommencez l'inscription.")
    if time.time() > pending["exp"]:
        raise HTTPException(410, "Ce code a expiré. Demandez-en un nouveau.")
    return pending, session


def count_try(pending, session, kind, limit, window):
    """At most `limit` code checks (or new codes) per window, for this PayByPhone account."""
    if HOSTED:
        if not store("rate_hit", p_key="%s:%s" % (kind, owner_id(session.username)), p_window_seconds=window,
                     p_max=limit):
            raise HTTPException(429, "Trop d'essais. Réessayez dans quelques minutes.")
    else:
        pending[kind] = pending.get(kind, 0) + 1
        if pending[kind] > limit:
            raise HTTPException(429, "Trop d'essais. Réessayez dans quelques minutes.")


class CodeCheck(BaseModel):
    code: str = Field(pattern=r"^\s*\d{3}\s?\d{3}\s*$")


@app.post("/api/signup/verify")
def verify_signup(body: CodeCheck, response: Response, pbb_pending: str = Cookie(None)):
    pending, session = read_pending(pbb_pending)
    count_try(pending, session, "code", CODE_TRIES, 900)
    code = re.sub(r"\D", "", body.code)
    if not hmac.compare_digest(code_hash(code, pending["email"]), pending["h"]):
        raise HTTPException(400, "Code incorrect. Vérifiez l'e-mail reçu.")
    # The home zone is found later from PayByPhone (or asked when the renewal is set up), not at sign-up.
    # The free month starts when the offer is chosen, not now. One per person: a new sign-up after deleting an
    # account (same PayByPhone account, e-mail or vehicle) keeps the first one's start, so it is not given again.
    earlier = earlier_trial(session, pending["email"])
    save_account(session, {"email": pending["email"], "origin": signup_origin(pending.get("src")),
                           **({"trial_start": earlier.isoformat(), "trial_kept": True} if earlier else {}),
                           **({"zone": pending["zone"], "zone_found": True} if pending.get("zone") else {})})
    session.remember = True  # a new user stays signed in (30 days), there is no box to tick at sign-up
    session.issued_at = int(time.time())
    if HOSTED:
        token = seal(session)
        refresh = getattr(session.bot, "refresh_token", None)
        if refresh:
            try:
                store("renewal_set_credential", p_owner=owner_id(session.username),
                      p_credential=encrypt_credential(refresh))
            except Exception as e:
                log.warning("could not refresh stored renewals: %s", e)
    else:
        try:
            token = seal(session)
        except Exception:  # nothing to seal it with: a plain token, lost on restart
            token = secrets.token_urlsafe(32)
        SESSIONS[token] = session
        PENDING.pop(pbb_pending or "", None)
    set_session_cookie(response, token, True)
    response.delete_cookie(PENDING_COOKIE, path="/api/signup")
    log.info("sign-up confirmed")
    remember_name(session)
    record_activity("Nouvelle inscription", session, ["Origine : %s." % ORIGIN_TEXT[signup_origin(pending.get("src"))]])
    return {"username": session.username, "demo": False, "hosted": HOSTED, "firstName": first_name(session)}


@app.post("/api/signup/resend")
def resend_signup_code(response: Response, pbb_pending: str = Cookie(None)):
    pending, session = read_pending(pbb_pending)
    if time.time() - pending.get("sent", 0) < 30:
        raise HTTPException(429, "Patientez quelques secondes avant de demander un nouveau code.")
    count_try(pending, session, "resend", 3, 3600)
    pending = {k: v for k, v in pending.items() if k in ("email", "zone", "s", "t", "src")}
    return start_verification(response, session, pending["email"], pending["zone"], pending)


@app.post("/api/logout")
def logout(response: Response, pbb_session: str = Cookie(None)):
    SESSIONS.pop(pbb_session or "", None)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


def current_build():
    """Name of the app script in the deployed index.html: open pages compare it with theirs to reload after an update."""
    try:
        found = re.search(r"/assets/(index-[\w-]+\.js)", (STATIC_DIR / "index.html").read_text())
        return found.group(1) if found else None
    except OSError:
        return None


@app.get("/api/config")
def config():
    """Public: lets the login page describe where credentials go."""
    return {"hosted": HOSTED, "turnstileSiteKey": turnstile_site_key() or None, "build": current_build(),
            "inviteOnly": INVITE_ONLY, "interrupted": service_interrupted()}


@app.get("/api/invite/{code}")
def invite_check(code: str):
    """Public: whether an invitation link is valid (the site opens only through one)."""
    return {"valid": valid_invite(code)}


class LinkOpen(BaseModel):
    source: str = Field(default="", max_length=40)  # WhatsApp, SMS, Instagram… (from the share button or the app)
    device: str = Field(default="", max_length=40)  # iPhone, Android, ordinateur…
    visit: int = Field(default=1, ge=1, le=9999)  # how many times this device opened the link (counted on the device)
    visitor: str = Field(default="", pattern=r"^[0-9a-f]{0,32}$")  # random id kept on the device: one visitor's visits


# How far a visitor who opened the private link went: the last step reached is shown on the same « Activité » row.
LINK_STEPS = {"inscription": "page d'inscription ouverte", "identifiants": "identifiants PayByPhone envoyés",
              "code": "code e-mail envoyé", "inscrit": "inscrit"}


class LinkProgress(LinkOpen):
    id: int
    sig: str = Field(max_length=64)
    step: str = Field(default="", max_length=20)
    seconds: int = Field(default=0, ge=0, le=7 * 86400)


def link_sig(row_id):
    """Proof that the visitor updating a link row is the one it was handed to (no account at that point)."""
    return hmac.new(_subkey(_secrets()[0], "link-open"), str(row_id).encode(), hashlib.sha256).hexdigest()[:24]


def link_detail(body, request, step="", seconds=None):
    """« WhatsApp · iPhone · Paris, FR · 1re visite · 45 s · → inscrit »: nothing more personal than the city."""
    from urllib.parse import unquote

    place = ", ".join(x for x in (unquote(request.headers.get("x-vercel-ip-city") or ""),
                                  request.headers.get("x-vercel-ip-country") or "") if x)
    parts = [body.source, body.device, place, "1re visite" if body.visit <= 1 else "déjà venu %d fois" % (body.visit - 1)]
    if seconds is not None:
        parts.append("rebond (%d s)" % seconds if seconds < 5 else
                     "%d s" % seconds if seconds < 60 else "%d min %02d s" % divmod(seconds, 60))
    if step:
        parts.append("→ inscrit" if step == "inscrit" else "→ arrêté à : %s" % LINK_STEPS[step])
    return " · ".join(x.strip() for x in parts if x and x.strip())


@app.post("/api/link-open")
def link_open(body: LinkOpen, request: Request):
    """The private link just opened (once per tab): where from, which device, roughly where (Vercel's city and
    country), first visit or not, for the admin's « Activité ». No IP and no cookie are kept. Answers the row and a
    signature, so the same row follows the visit (steps, time spent)."""
    if not HOSTED:
        return {"id": None, "sig": None}
    try:
        data = _fernet("activity").encrypt(json.dumps({"who": None, "detail": link_detail(body, request),
                                                       "visitor": body.visitor}).encode())
        row_id = store("activity_add_id", p_event="Lien privé ouvert", p_data=data.decode())
    except Exception as e:
        log.warning("link open not recorded: %s", type(e).__name__)
        return {"id": None, "sig": None}
    return {"id": row_id, "sig": link_sig(row_id)}


@app.post("/api/link-progress")
def link_progress(body: LinkProgress, request: Request):
    """The visitor went on (a sign-up step, or left the page after so many seconds): the same row is rewritten."""
    if not hmac.compare_digest(body.sig, link_sig(body.id)) or (body.step and body.step not in LINK_STEPS):
        raise HTTPException(400, "Suivi refusé.")
    if HOSTED:
        try:
            detail = link_detail(body, request, body.step, body.seconds)
            data = _fernet("activity").encrypt(json.dumps({"who": None, "detail": detail,
                                                           "visitor": body.visitor}).encode()).decode()
            store("activity_update_link", p_id=body.id, p_data=data)
        except Exception as e:
            log.warning("link progress not recorded: %s", type(e).__name__)
    return {"ok": True}


class AccessAsk(BaseModel):
    email: str = Field(max_length=254)
    turnstile: str = Field(default="", max_length=2048)


ACCESS_PER_EMAIL = 3  # links sent to one address a day
ACCESS_PER_DAY = 50  # links sent in all a day: Resend's quota stays for the customers


@app.post("/api/access")
def request_access(body: AccessAsk, request: Request):
    """Public (no link yet): the private link sent to the e-mail typed on the blurred home page. The answer is the same
    whether it went out or not (an address asked too often is skipped quietly)."""
    check_human(request, body.turnstile)
    email = body.email.strip()
    check_email(email)
    if not email:
        raise HTTPException(400, "Indiquez votre adresse e-mail.")
    code = SHARED_INVITE or invite_code("access")
    link = APP_URL.rstrip("/") + "/r/" + code + "/?s=acces"  # tagged: the visit and the sign-up show « sans parrainage »
    if HOSTED:
        day = paris_day()
        who = hashlib.sha256(email.lower().encode()).hexdigest()[:16]  # counted without keeping the address
        counts = guarded(lambda: store("usage_add", p_keys=["access-day:" + day, "access-email:%s:%s" % (who, day)]))
        if counts.get("access-day:" + day, 0) > ACCESS_PER_DAY:
            raise HTTPException(429, "Trop de demandes aujourd'hui. Réessayez demain.")
        if counts.get("access-email:%s:%s" % (who, day), 0) > ACCESS_PER_EMAIL:
            return {"ok": True}
    send_email(email, "Votre accès à PayByBot", "Votre lien d'accès",
               ["Bonjour,", "Voici votre lien pour ouvrir PayByBot et créer votre compte. Il reste valable : gardez-le, "
                "et partagez-le avec vos proches si vous le souhaitez.",
                "Vous n'avez rien demandé ? Ignorez simplement cet e-mail."],
               ("Ouvrir PayByBot", link),
               footer="Vous recevez cet e-mail parce que cette adresse a été saisie sur paybybot.fr.")
    record_activity("Demande d'accès", lines=["E-mail : %s." % email])
    log.info("access link sent")
    return {"ok": True}


@app.get("/api/invite")
def my_invite(pbb_session: str = Cookie(None)):
    """The signed-in user's invitation link, to share with people around them."""
    s = current(pbb_session)
    code = SHARED_INVITE or invite_code(owner_id(s.username))
    # The trailing slash makes a new address for WhatsApp, which keeps a link's preview: it then reads the current
    # one (og-v7, « stationnement résident »). Change it again (e.g. /r/<code>/?v=8) after a new preview image.
    return {"code": code, "url": APP_URL.rstrip("/") + "/r/" + code + "/"}


@app.get("/api/me")
def me(pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    if HOSTED and not s.demo:  # accounts made before one e-mail per account: their fingerprint, once
        try:
            account = load_account(s)
            if account.get("email") and not account.get("email_keyed"):
                keep_email_key(owner_id(s.username), account["email"])
                save_account(s, {"email_keyed": True})
        except Exception as e:
            log.info("e-mail fingerprint backfill skipped: %s", type(e).__name__)
    return {"username": s.username, "demo": s.demo, "hosted": HOSTED, "firstName": first_name(s)}


def token_claims(session):
    """The fields of PayByPhone's access token (a JWT), read without verifying it: only used for display."""
    if session.demo:
        return {}
    try:
        payload = (getattr(session.bot, "authorization", "") or "").split(" ")[-1].split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:
        return {}


def remember_name(session):
    """Online, keep the holder's first name with the account (encrypted), for the owner's client list."""
    if not HOSTED or session.demo:
        return
    try:
        name = first_name(session)
        if name and load_account(session) and load_account(session).get("first_name") != name:
            save_account(session, {"first_name": name})
    except Exception as e:
        log.info("first name not kept: %s", type(e).__name__)


def first_name(session):
    """The account holder's first name if PayByPhone gives it, for the greeting; None otherwise."""
    claims = token_claims(session)
    for key in ("given_name", "firstName", "first_name", "givenName"):
        if isinstance(claims.get(key), str) and claims[key].strip():
            return claims[key].strip()[:40]
    name = claims.get("name")
    if isinstance(name, str) and name.strip() and "@" not in name and not name.strip().lstrip("+").isdigit():
        return name.strip().split()[0][:40]
    return None


def error_status(e):
    """The HTTP status for a PayByPhone failure: 422 when PayByPhone refuses what was asked (a ticket already
    running, no rate in the zone, payment declined: the user's case, not a bug), 503 when it is busy or unreachable
    (429, 5xx, network), 502 for anything else (unexpected: reported to Sentry)."""
    text = str(e)
    if isinstance(e, requests.HTTPError) and e.response is not None:
        code = e.response.status_code
        return 422 if code in (400, 401) else 503 if code == 429 or code >= 500 else 502
    if isinstance(e, requests.ConnectionError):
        return 503
    if "Quote error" in text or "Payment job failed" in text or ("GraphQL error" in text and "getRateOptions" in text):
        return 422
    return 502


def guarded(fn):
    try:
        return fn()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(error_status(e), friendly_error(e))


@app.get("/api/overview")
def overview(pbb_session: str = Cookie(None)):
    s = current(pbb_session)

    def load():
        if HOSTED and s.demo:  # no background loop on a serverless host: a demo renewal runs when the page loads
            for ap in list(s.autopilots.values()):
                if ap.get("enabled"):
                    run_autopilot(s, ap)
        def kept_zones():  # each vehicle's resident arrondissement, as found on PayByPhone and kept (see vehicle_zones)
            try:
                return load_account(s).get("vehicle_zones") or {}
            except Exception:
                return {}

        def renewals():
            if HOSTED and not s.demo:
                return [stored_to_autopilot(r) for r in store("renewal_list", p_owner=owner_id(s.username))]
            return [with_next_ticket(a) for a in s.autopilots.values()]

        # The five reads go out together: the page waits for the slowest one, not for their sum.
        jobs = {"vehicles": lambda: s.call("get_vehicles"), "accounts": lambda: s.call("get_payment_accounts"),
                "sessions": lambda: s.call("get_parking_sessions"), "kept": kept_zones, "renewals": renewals}
        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            futures = {k: pool.submit(contextvars.copy_context().run, f) for k, f in jobs.items()}
            got = {k: f.result() for k, f in futures.items()}
        vehicles = [v for v in got["vehicles"] if not v.get("archived")]
        accounts = got["accounts"] or {}
        payments = normalize_accounts(accounts)
        if not payments and not s.demo:
            # Only types and counts, never card details: helps spot a payment type we don't handle yet.
            log.info("no usable payment method; PayByPhone returned %s",
                     {k: len(v) if isinstance(v, list) else type(v).__name__ for k, v in accounts.items()})
        kept = got["kept"]
        return {
            "vehicles": [{"plate": v["licensePlate"], "country": v.get("country"), "type": v.get("type"),
                          "zone": (kept.get(plate_key(v["licensePlate"])) or {}).get("z")} for v in vehicles],
            "payments": payments,
            "sessions": [serialize_session(x) for x in got["sessions"]],
            "autopilots": got["renewals"],
            "history": s.history[:10],
        }

    return guarded(load)


def french_zone(s, number):
    """Whether PayByPhone knows this zone number in France (PayByBot works in France only). True when PayByPhone
    cannot tell right now: the rates asked next say it anyway."""
    try:
        found = s.call("find_locations", number) or []
    except Exception as e:
        log.info("zone lookup unavailable: %s", str(e)[:200])
        return True
    return any(str(x.get("countryCode") or "").upper() in ("FR", "FRA") for x in found)


@app.get("/api/zone")
def zone_check(number: str, pbb_session: str = Cookie(None)):
    """Is this a PayByPhone zone in France? Checked before asking its rates."""
    s = current(pbb_session)
    number = number.strip()
    if not re.fullmatch(r"[0-9A-Za-z]{1,12}", number):
        return {"found": False}
    return {"found": french_zone(s, number)}


@app.get("/api/rates")
def rates(location: str, plate: str, pbb_session: str = Cookie(None)):
    s = current(pbb_session)

    def read():
        found = s.call("get_rate_options", locationId=location.strip(), licensePlate=plate)
        log.info("rates zone=%s: %s", location.strip()[:8], [(r.get("type"), r.get("acceptedTimeUnits")) for r in found or []])
        return found
    return guarded(read)


@app.get("/api/last-card")
def last_card(pbb_session: str = Cookie(None)):
    """The card PayByPhone was last paid with (from the receipt of the latest tickets), to choose it by default:
    PayByPhone keeps no « default card » on its side, only on the phone. None when unknown."""
    s = current(pbb_session)
    try:
        cards = [c for c in (s.call("get_payment_accounts") or {}).get("paymentCards") or []]
        sessions = s.call("get_parking_sessions") + s.call("get_past_sessions", limit=10)
        sessions.sort(key=lambda x: parse_dt(x.get("startTime")) or datetime.min.replace(tzinfo=timezone.utc),
                      reverse=True)
        for x in sessions[:3]:
            for receipt in s.call("get_receipts", x.get("parkingSessionId")) or []:
                digits = ((receipt.get("paymentMethod") or {}).get("lastFourDigitsOfCardNumber") or "")[-4:]
                match = [c for c in cards if digits and (c.get("maskedCardNumber") or "").endswith(digits)]
                if match:
                    return {"paymentAccountId": match[0]["paymentAccountId"]}
    except Exception as e:  # a convenience: never block the window for it
        log.info("last card unknown: %s", str(e)[:300])
    return {"paymentAccountId": None}


@app.get("/api/last-rate")
def last_rate(location: str, plate: str, pbb_session: str = Cookie(None)):
    """The rate this car used last, from PayByPhone's history: in this zone first, otherwise anywhere."""
    s = current(pbb_session)
    try:
        sessions = s.call("get_past_sessions", limit=30) + s.call("get_parking_sessions")
    except Exception as e:  # history is a convenience: never block the payment for it
        log.info("history unavailable: %s", str(e)[:200])
        return {"rate": None, "inZone": False}
    mine = [x for x in sessions if (x.get("vehicle") or {}).get("licensePlate") == plate]
    mine.sort(key=lambda x: x.get("startTime") or datetime.min, reverse=True)
    for in_zone in (True, False):
        for x in mine:
            if (x.get("locationId") == location.strip()) == in_zone or not in_zone:
                rate = (x.get("ratePolicy") or {}).get("ratePolicyId")
                if rate:
                    return {"rate": str(rate), "inZone": in_zone}
    return {"rate": None, "inZone": False}


class QuoteRequest(Parking):
    sessionId: str = Field(default="", max_length=80)  # set to price an extension of this session
    renewal: bool = False  # pricing a renewal: a ticket already running must not block it


@app.post("/api/quote")
def quote(body: QuoteRequest, pbb_session: str = Cookie(None)):
    s = current(pbb_session)

    def ask(operation, session_id):
        q = s.call("_create_quote", locationId=body.location, ratePolicyId=body.rate,
                   durationQuantity=fmt_qty(body.duration), durationTimeUnit=body.unit,
                   licensePlate=body.plate, paymentAccountId=body.paymentAccountId,
                   operation=operation, parkingSessionId=session_id)
        details = q.get("details") or {}
        return {"cost": q.get("cost"), "start": iso(details.get("parkingStartTime")),
                "expire": iso(details.get("parkingExpiryTime"))}

    def run():
        if body.sessionId:
            return ask("Extend", body.sessionId)
        try:
            return ask("Start", "")
        except Exception as e:
            if not (body.renewal and "VehicleAlreadyParked" in str(e)):
                raise
        # A ticket is running: the renewal starts when it ends. Its price is that of the same stay added to
        # the running ticket when PayByPhone quotes it, otherwise unknown until the first renewal.
        running = running_for(s, body.plate)
        until = iso(covered_until(running)) if running else None
        for x in running:
            try:
                q = ask("Extend", x.get("parkingSessionId"))
            except Exception as e:  # e.g. a visitor ticket cannot be extended at the resident rate
                log.info("renewal price as an extension refused: %s", str(e)[:200])
                continue
            # PayByPhone may cap an extension (longest stay allowed): its price is then that of a few hours, not
            # of the week asked. Only an extension of the full stay gives the renewal's price.
            ends = parse_dt(covered_until([x]))
            added = parse_dt(q.get("expire")) - ends if q.get("expire") and ends else None
            asked = timedelta(**{body.unit.lower(): float(body.duration)})
            if added is not None and abs(added - asked) <= timedelta(hours=2):
                return {**q, "afterCurrent": True, "currentExpire": until}
            log.info("renewal price as an extension: only %s added out of %s, not used", added, asked)
        cost, source = known_price(s, body)
        return {"cost": cost, "priceSource": source, "start": None, "expire": None, "afterCurrent": True,
                "currentExpire": until}

    return guarded(run)


# Paris resident rate (tarif résidentiel), used only when PayByPhone cannot quote the week right now.
PARIS_RESIDENT_WEEK = {"amount": 9.0, "currency": "EUR"}


def known_price(s, body):
    """Price of the stay when PayByPhone refuses to quote it (a ticket is running): what this car paid for the
    same stay at the same rate, from PayByPhone's history, else the Paris resident rate. (cost, source)."""
    span = WEEK if body.unit == "Days" and float(body.duration) == 7 else None
    try:
        history = s.call("get_past_sessions", limit=30) + s.call("get_parking_sessions")
    except Exception as e:
        log.info("history unavailable for the price: %s", str(e)[:200])
        history = []
    for x in history:
        start, end = parse_dt(x.get("startTime")), parse_dt(x.get("expireTime"))
        if (span and start and end and abs((end - start) - span) < timedelta(hours=2)
                and same_plate((x.get("vehicle") or {}).get("licensePlate"), body.plate)
                and str((x.get("ratePolicy") or {}).get("ratePolicyId")) == str(body.rate)
                and (x.get("totalCost") or {}).get("amount")):
            return x["totalCost"], "history"
    if span and re.fullmatch(r"75\d{3}", body.location.strip()):
        rates = s.call("get_rate_options", body.location.strip(), body.plate) or []
        if any(str(r.get("ratePolicyId")) == str(body.rate) and RESIDENT_RATE.search("%s %s" % (r.get("name"), r.get("type")))
               and not TWO_WHEELS.search("%s %s" % (r.get("name"), r.get("type"))) for r in rates):  # car rate only
            return PARIS_RESIDENT_WEEK, "paris"
    return None, None


WEEK = timedelta(days=7)

# The subscription: one monthly price per renewed vehicle, whatever its ticket (resident, visitor, Handi) and type.
# Per year: twelve months with 20 % off.
YEARLY_DISCOUNT = 0.20
MONTHLY_PRICE = 950
# The Paris resident week when PayByPhone does not give it: car (any weight) 9 €, two-wheeler 4.50 €, electric free.
RESIDENT_WEEK = {"car": 900, "two": 450, "electric": 0}
ELECTRIC_TWO_WHEELS = re.compile(r"electric\s*motorcycle|deux[\s-]*roues\s*[ée]lectrique", re.I)
DEFAULT_MONTHLY_CENTS = MONTHLY_PRICE


def paris_zone(zone):
    """1 for arrondissements 1 to 11 (750xx), 2 for 12 to 20; 1 when unknown."""
    m = re.fullmatch(r"750(\d\d)", str(zone or ""))
    return 2 if m and int(m.group(1)) >= 12 else 1


def resident_week(vehicle_type):
    """The official Paris resident week for this vehicle type, in cents."""
    t = str(vehicle_type or "")
    return RESIDENT_WEEK["electric" if ELECTRIC_TWO_WHEELS.search(t) else "two" if TWO_WHEELS.search(t) else "car"]


def monthly_cents(vehicle_type, zone=None, suv=False, weekly=None):
    """The single monthly price: neither the vehicle, its zone nor PayByPhone's price change it any more (the
    arguments stay for the callers)."""
    return MONTHLY_PRICE


def plan_total(monthlies, plan="monthly"):
    """The subscription for several vehicles: the sum of their monthly prices; per year twelve months with 20 % off."""
    monthly = sum(int(m) for m in monthlies) or DEFAULT_MONTHLY_CENTS
    return monthly if plan == "monthly" else int(round(monthly * 12 * (1 - YEARLY_DISCOUNT)))


def now_utc():
    return datetime.now(timezone.utc)


def add_months(dt, n):
    year, month = divmod(dt.month - 1 + n, 12)
    year, month = dt.year + year, month + 1
    return dt.replace(year=year, month=month, day=min(dt.day, calendar.monthrange(year, month)[1]))


def months_left(now, end):
    """Months until the next billing date, the month already started counting whole (never billed by the day)."""
    n = 1
    while add_months(now, n) < end:
        n += 1
    return n


def change_cents(plan, months, added, removed):
    """(charged now, credited on the next invoice) when vehicles are added or removed. The month started is always
    due: an added vehicle pays it whole (yearly: with the months left, at the yearly price); a removed one keeps it,
    and a yearly subscription is credited the whole months after it."""
    if plan != "yearly":
        return MONTHLY_PRICE * added, 0
    month = int(MONTHLY_PRICE * (1 - YEARLY_DISCOUNT))
    return month * months * added, month * (months - 1) * removed


def plate_key(plate):
    """A plate as compared: « AB-123 cd » and « AB123CD » are the same vehicle."""
    return re.sub(r"[^0-9A-Z]", "", str(plate).upper())


def vehicle_resident_rate(s, zone, vehicle):
    """The resident rate PayByPhone offers this vehicle in the zone (two-wheelers: the two-wheeler one), or None."""
    wants_two = bool(TWO_WHEELS.search(str(vehicle.get("type") or "")))
    try:
        rates = s.call("get_rate_options", zone, vehicle["licensePlate"]) or []
    except Exception as e:
        if "getRateOptions" in str(e):  # PayByPhone has no rate there for this vehicle: no resident rate, a real « no »
            return None
        raise  # busy (429) or unreachable: not known, never taken for « no »
    return next((r for r in rates if RESIDENT_RATE.search("%s %s" % (r.get("name"), r.get("type")))
                 and bool(TWO_WHEELS.search("%s %s" % (r.get("name"), r.get("type")))) == wants_two
                 and not r.get("parkingNotAllowedReason")), None)


def resident_vehicles(s, zone):
    """The account's vehicles with a resident rate in the home zone, cars first, with that rate: [(vehicle, rate)].
    PayByBot only deals with these « riverain » vehicles."""
    vehicles = [v for v in s.call("get_vehicles") if not v.get("archived")]
    vehicles.sort(key=lambda v: bool(TWO_WHEELS.search(str(v.get("type") or ""))))
    found = []
    for vehicle in vehicles:
        rate = vehicle_resident_rate(s, zone, vehicle)
        if rate:
            found.append((vehicle, rate))
    return found


def resident_rate(s, zone):
    """(plate, rate) of the first resident vehicle in the zone, cars first; (None, None) when there is none: the
    resident status (carte résident) is not active there for any of its vehicles."""
    found = resident_vehicles(s, zone)
    return (found[0][0]["licensePlate"], found[0][1]) if found else (None, None)


def weekly_resident_cents(s, zone):
    """What a week at the resident rate costs this account in its home zone, in cents (None if unknown)."""
    plate, rate = resident_rate(s, zone)
    return week_price(s, zone, plate, rate) if rate else None


VEHICLE_ZONE_RECHECK = 12 * 3600  # a vehicle without a resident rate is looked for again after 12 hours


def vehicle_zones(s, keep=True):
    """Each riverain vehicle with its arrondissement and resident rate, cars first: [(vehicle, zone, rate)].
    Always found on PayByPhone, never typed: the arrondissement kept for it, else another vehicle's, the home one or
    the history's, else searched among the 20. Kept on the account (keep=False at sign-up: nothing is stored yet)."""
    vehicles = [v for v in s.call("get_vehicles") if not v.get("archived")]
    vehicles.sort(key=lambda v: bool(TWO_WHEELS.search(str(v.get("type") or ""))))  # cars first
    account = load_account(s) if keep else {}
    kept = dict(account.get("vehicle_zones") or {})
    now, found, changed = time.time(), [], False
    home, looked = None, False  # the home zone, only looked up when a vehicle needs it

    def long_ticket(x):  # a resident week, not a visitor's hours or a Handi day
        start, end = parse_dt(x.get("startTime")), parse_dt(x.get("expireTime"))
        return bool(start and end and end - start >= timedelta(days=2))

    try:  # the zone of a resident ticket running now: the first place to look, whatever was kept before
        running = {plate_key((x.get("vehicle") or {}).get("licensePlate") or ""): str(x.get("locationId"))
                   for x in s.call("get_parking_sessions") or [] if long_ticket(x) and x.get("locationId")}
    except Exception as e:
        log.info("running tickets unavailable for the zones: %s", type(e).__name__)
        running = {}
    for vehicle in vehicles:
        key = plate_key(vehicle["licensePlate"])
        entry = kept.get(key) or {}
        ticket_zone = running.get(key)
        zone = rate = None
        if entry.get("z"):
            rate = vehicle_resident_rate(s, entry["z"], vehicle)
            zone = entry["z"] if rate else None
        elif entry and now - entry.get("t", 0) < VEHICLE_ZONE_RECHECK and not ticket_zone:
            continue  # no resident rate a little while ago (and no resident ticket now): not searched again yet
        if not zone:  # not known yet, or no resident rate there any more (a move)
            if not looked:
                home, looked = (find_home_zone(s, scan=False) or {}).get("zone"), True
            tried = {entry.get("z")}
            for z in dict.fromkeys([ticket_zone] + [z for _, z, _ in found] + [home]):
                if z and z not in tried:
                    tried.add(z)
                    rate = vehicle_resident_rate(s, z, vehicle)
                    if rate:
                        zone = z
                        break
            if not zone:
                try:
                    zone = scan_vehicle_zone(s, vehicle)
                except ScanIncomplete as e:  # not known: looked for again in 10 minutes, never cached as « no »
                    log.info("vehicle zone scan incomplete: %s", e)
                    kept[key] = {"z": None, "t": int(now) - VEHICLE_ZONE_RECHECK + 600}
                    changed = True
                    continue
                rate = vehicle_resident_rate(s, zone, vehicle) if zone else None
                zone = zone if rate else None
            kept[key] = {"z": zone, "t": int(now)}
            changed = True
        if zone and rate:
            found.append((vehicle, zone, rate))
    if keep and changed:
        patch = {"vehicle_zones": kept}
        if found and account.get("zone") != found[0][1]:
            patch.update(zone=found[0][1], zone_found=True)
        try:
            save_account(s, patch)
        except Exception as e:
            log.warning("vehicle zones not kept: %s", type(e).__name__)
    return found


def rule_over(details, now=None):
    """A ticket chosen on the calendar with nothing left to take: no ticket to come, none being taken now, and the
    last one it took has ended. It then neither holds the car (a new ticket can be programmed for it) nor counts in
    the subscription. Same rule as ruleState() in DailyTickets.tsx."""
    rule = rule_of(details)
    if not rule or not rule.get("date_to"):
        return False
    now = now or datetime.now(timezone.utc)
    if schedule.next_slot(rule, now) is not None:
        return False
    last = parse_dt((details or {}).get("last_payment") or (details or {}).get("lastPayment"))
    slot = schedule.current_slot(rule, now)
    if slot and not (last and last >= slot[0]):
        return False  # its ticket of today is being taken
    length = {"Minutes": timedelta(minutes=1), "Hours": timedelta(hours=1)}.get(rule.get("unit"), timedelta(days=1))
    return not (last and last + length * float(rule.get("duration") or 1) > now)


def renewed_plates(s):
    """Plates with an active resident renewal: the subscription is for these vehicles."""
    if HOSTED and not s.demo:
        rows = store("renewal_list", p_owner=owner_id(s.username)) or []
        plates = []
        for row in rows:
            try:
                details = with_details(row)
                if not rule_over(details):
                    plates.append(details["plate"])
            except Exception as e:
                log.warning("renewal %s: unreadable details: %s", row.get("id"), e)
    else:
        plates = [ap["plate"] for ap in s.autopilots.values() if not rule_over(ap)]
    return {plate_key(p) for p in plates}


def week_price(s, zone, plate, rate, payments=None):
    """What a week at this resident rate costs this vehicle, in cents: PayByPhone's quote, else the history."""
    payments = normalize_accounts(s.call("get_payment_accounts") or {}) if payments is None else payments
    if payments:
        try:
            q = s.call("_create_quote", locationId=zone, ratePolicyId=str(rate["ratePolicyId"]), durationQuantity=7,
                       durationTimeUnit="Days", licensePlate=plate, paymentAccountId=payments[0]["id"],
                       operation="Start", parkingSessionId="")
            if (q.get("cost") or {}).get("amount") is not None:  # 0: a free resident week
                return int(round(float(q["cost"]["amount"]) * 100))
        except Exception as e:  # e.g. a ticket is running: fall back on the history
            log.info("weekly price quote refused: %s", str(e)[:200])
    body = Parking(location=zone, rate=str(rate["ratePolicyId"]), duration=7, unit="Days", plate=plate,
                   paymentAccountId=payments[0]["id"] if payments else "")
    cost, _ = known_price(s, body)
    return int(round(float(cost["amount"]) * 100)) if cost and cost.get("amount") is not None else None


def account_pricing(s):
    """The account's prices: one monthly price per riverain vehicle (its type, its arrondissement's zone), and the
    subscription, for the vehicles with a renewal (the first one while none has). The billed prices are kept on the
    account for checkout and the e-mail links. Without a riverain vehicle, every vehicle of the account; None without
    any vehicle; the vehicles are listed even when their zones cannot be looked for (then without a zone)."""
    try:
        found, zones_known = vehicle_zones(s), True
    except HTTPException:
        raise
    except Exception as e:  # PayByPhone busy or refusing: every vehicle listed anyway, nothing kept from this answer
        log.warning("pricing without the vehicle zones: %s", str(e)[:200])
        found, zones_known = [], False
    account = load_account(s)
    suvs = set(account.get("suv_plates") or [])
    payments = normalize_accounts(s.call("get_payment_accounts") or {}) if found else []

    def weekly(zone, plate, rate):  # the resident week PayByPhone charges for this car (shown, never billed by us)
        try:
            return week_price(s, zone, plate, rate, payments)
        except Exception as e:
            log.info("weekly price unavailable: %s", str(e)[:200])
            return None

    vehicles = []
    for v, zone, rate in found:
        week = weekly(zone, v["licensePlate"], rate)
        vehicles.append({"plate": v["licensePlate"], "type": v.get("type"), "zone": zone,
                         "suv": plate_key(v["licensePlate"]) in suvs,
                         "monthly": monthly_cents(v.get("type"), zone, weekly=week), "weekly": week,
                         "rate": rate})  # the renewal window uses it as is (no second rate lookup)
    # Then the other vehicles (no resident rate: tickets on chosen days), at the same single price: a ticket
    # programmed on one of them is billed like a resident renewal.
    seen = {plate_key(v["plate"]) for v in vehicles}
    vehicles += [{"plate": v["licensePlate"], "type": v.get("type"), "zone": None, "suv": False,
                  "monthly": monthly_cents(v.get("type")), "weekly": None}
                 for v in s.call("get_vehicles") or []
                 if not v.get("archived") and v.get("licensePlate") and plate_key(v["licensePlate"]) not in seen]
    if not vehicles:
        return None
    zone = vehicles[0]["zone"]
    renewed = renewed_plates(s)
    # Billed: the vehicles chosen on the offer screen and those with a renewal (the first one while none is).
    chosen = set(account.get("chosen_plates") or [])
    billed = [v for v in vehicles if plate_key(v["plate"]) in renewed or plate_key(v["plate"]) in chosen] or vehicles[:1]
    monthlies = sorted(v["monthly"] for v in billed)
    if zones_known and (account.get("monthlies") != monthlies or account.get("price_zone") != zone):
        account = save_account(s, {"monthlies": monthlies, "price_zone": zone})
        reprice(account, owner_id(s.username) if HOSTED and not s.demo else None)
    return {"zone": zone, "monthly": plan_total(monthlies), "yearly": plan_total(monthlies, "yearly"),
            # False when PayByPhone could not be asked for the zones: no zone then does not mean « not resident ».
            "zonesKnown": zones_known,
            "billed": [v["plate"] for v in billed],
            "vehicles": [{**v, "yearly": plan_total([v["monthly"]], "yearly"), "renewed": plate_key(v["plate"]) in renewed}
                         for v in vehicles]}


def follow_renewals(s):
    """A renewal was added or stopped: a running subscription follows the renewed vehicles (next billing date)."""
    if not HOSTED or s.demo:
        return
    try:
        if load_account(s).get("stripe_subscription"):
            account_pricing(s)
    except Exception as e:
        log.warning("subscription not updated for the renewed vehicles: %s", type(e).__name__)


def account_monthlies(account):
    """The monthly prices the subscription is for (not priced yet: one car in zone 1)."""
    if account.get("monthlies"):
        return [int(m) for m in account["monthlies"]]
    return [DEFAULT_MONTHLY_CENTS]


def billed_monthlies(account):
    """The monthly prices the running subscription was last billed with (None: not recorded, e.g. the old rule)."""
    return [int(m) for m in account["billed_monthlies"]] if account.get("billed_monthlies") else None


def monthlies_from(metadata):
    """The monthly prices a Checkout session was priced with, from its metadata."""
    text = (metadata or {}).get("monthlies") or ""
    return [int(m) for m in str(text).split(",") if m.strip().isdigit()] or None


def fmt_qty(value):
    return int(value) if float(value).is_integer() else value


@app.post("/api/pay")
def pay(body: Parking, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    guarded(lambda: ensure_covered(s, body.plate))

    def run():
        pending = s.unconfirmed.get((body.plate, body.location))
        if pending and time.time() - pending < 30 * 60:
            raise HTTPException(423, "Un paiement précédent pour ce véhicule dans cette zone n'a pas été confirmé. "
                                     "Vérifiez dans l'application PayByPhone avant de payer à nouveau.")
        if s.call("get_parking_sessions", licensePlate=body.plate, locationId=body.location):
            raise HTTPException(409, "Un stationnement est déjà en cours pour %s dans cette zone." % body.plate)
        try:
            result, found = pay_and_confirm(s, body.location, body.rate, fmt_qty(body.duration), body.unit,
                                            body.plate, body.paymentAccountId)
        except Unconfirmed as e:
            if isinstance(e, BankCheck):
                read_bank_page(s, e.job_id, opening=True)
            raise HTTPException(504, str(e))
        s.log("success", "Stationnement payé : zone %s, %s" % (body.location, body.plate))
        expire = max(x["expireTime"] for x in found)
        return {"ok": True, "expire": iso(expire), "cost": result.get("cost")}

    try:
        return guarded(run)
    except HTTPException as e:
        if e.status_code in (422, 502, 503, 504):
            log.warning("pay failed: %s", e.detail)
            s.log("error", "Paiement échoué (zone %s) : %s" % (body.location, e.detail))
        raise


@app.post("/api/extend")
def extend(body: Extension, pbb_session: str = Cookie(None)):
    s = current(pbb_session)

    def run():
        pending = s.unconfirmed.get((body.plate, body.location))
        if pending and time.time() - pending < 30 * 60:
            raise HTTPException(423, "Un paiement précédent pour ce véhicule dans cette zone n'a pas été confirmé. "
                                     "Vérifiez dans l'application PayByPhone avant de payer à nouveau.")
        before = next((x for x in s.call("get_parking_sessions", licensePlate=body.plate, locationId=body.location)
                       if x.get("parkingSessionId") == body.sessionId), None)
        if before is None:
            raise HTTPException(409, "Ce ticket n'est plus en cours : il ne peut pas être prolongé.")
        before_expire = before["expireTime"]  # keep the value: the session dict may be updated in place
        log.info("extend: session=%s zone=%s %s %s plate=%s demo=%s", body.sessionId, body.location,
                 body.duration, body.unit, body.plate[:2] + "***", s.demo)
        try:
            result = s.call("extend", parkingSessionId=body.sessionId, durationQuantity=fmt_qty(body.duration),
                            durationTimeUnit=body.unit, licensePlate=body.plate, locationId=body.location,
                            ratePolicyId=body.rate, paymentAccountId=body.paymentAccountId)
        except Exception as e:
            log.warning("extend: PayByPhone refused: %s", str(e)[:1000])
            raise
        log.info("extend: PayByPhone answered jobId=%s jobStatus=%s cost=%s new expire=%s", result.get("jobId"),
                 result.get("jobStatus"), result.get("cost"), result.get("expireTime"))
        s.attempts.append({"at": datetime.now(timezone.utc).isoformat(), "location": body.location,
                           "plate": body.plate, "operation": "extend",
                           **{k: result.get(k) for k in ("quoteId", "parkingSessionId", "jobId", "jobStatus")}})
        # Confirmed only once PayByPhone lists the session with its later end time.
        for i in range(10):
            now = next((x for x in s.call("get_parking_sessions", licensePlate=body.plate, locationId=body.location)
                        if x.get("parkingSessionId") == body.sessionId), None)
            if now and now["expireTime"] > before_expire:
                log.info("extend: confirmed after %s check(s)", i + 1)
                s.log("success", "Ticket prolongé : zone %s, %s" % (body.location, body.plate))
                return {"ok": True, "expire": iso(now["expireTime"]), "cost": result.get("cost")}
            if not s.demo:
                time.sleep(3)
        s.unconfirmed[(body.plate, body.location)] = time.time()
        log.warning("extend: end time unchanged for session %s", body.sessionId)
        log_diagnosis(s)
        raise HTTPException(504, UNCONFIRMED)

    try:
        return guarded(run)
    except HTTPException as e:
        if e.status_code in (422, 502, 503, 504):
            log.warning("extend failed: %s", e.detail)
        raise


@app.get("/api/debug")
def debug(pbb_session: str = Cookie(None)):
    if HOSTED:  # diagnosis stays in the server logs online
        raise HTTPException(404)
    s = current(pbb_session)
    report = guarded(lambda: diagnosis(s))
    log.warning("diagnosis (on demand): %s", json.dumps(report, default=str))
    return report


CARD_NEEDS_CHECK = ("Votre banque a refusé ce paiement automatique : payez vous-même votre ticket dans l'application "
                    "PayByPhone, et vérifiez votre carte.")


def mail_check_failed(s, plate, message):
    """The check before activating could not pay: the same e-mail as a renewal that cannot pay, with the
    PayByPhone button. At most one an hour per vehicle, the check being easy to run again."""
    if not HOSTED or s.demo:
        return
    try:
        account = load_account(s)
        to, now = account.get("email"), datetime.now(timezone.utc)
        mailed = account.get("check_mailed") or {}
        last = parse_dt(mailed.get(plate_key(plate)))
        if not to or (last and now - last < timedelta(hours=1)):
            return
        send_email(to, "Action requise · renouvellement %s" % plate_text(plate), "Le renouvellement a besoin de vous",
                   ["Le renouvellement automatique pour %s n'a pas pu être activé :" % plate_text(plate), message,
                    "Réglez-le dans l'application PayByPhone, puis activez le renouvellement depuis PayByBot."],
                   ("Ouvrir PayByPhone", PAYBYPHONE_URL))
        save_account(s, {"check_mailed": {**mailed, plate_key(plate): now.isoformat()}})
    except Exception as e:
        log.warning("check e-mail failed: %s", str(e)[:200])


def checked_days(body):
    """The days and time of a programmed ticket (none for the weekly renewal), the calendar dates checked."""
    days = sorted(set(body.days)) if body.days else None
    if body.dateFrom or body.dateTo:  # chosen on the calendar: a day or a period, never in the past
        first, last = body.dateFrom or body.dateTo, body.dateTo or body.dateFrom
        today = datetime.now(PARIS).date()
        if not days or first > last or date.fromisoformat(last) < today or \
                date.fromisoformat(last) - date.fromisoformat(first) > timedelta(days=366):
            raise HTTPException(400, "Choisissez un jour ou une période à venir, d'un an au plus.")
        body.dateFrom, body.dateTo = first, last
        # Today at an hour already gone: it would be saved and never taken.
        rule = {"days": days, "start": body.start or schedule.DEFAULT_START, "unit": body.unit, "duration": body.duration,
                "location": body.location, "tz": body.tz, "date_from": first, "date_to": last}
        now = datetime.now(timezone.utc)
        if not schedule.current_slot(rule, now) and not schedule.next_slot(rule, now):
            raise HTTPException(400, "Cette heure est déjà passée : choisissez une heure ou un jour à venir.")
    return days, ((body.start or schedule.DEFAULT_START) if days else None)


def check_card(s, payment_account_id):
    """Renewals pay with a card saved on PayByPhone (nothing else is charged reliably without the user)."""
    cards = {p["id"] for p in guarded(lambda: normalize_accounts(s.call("get_payment_accounts") or {})) if p["kind"] == "card"}
    if payment_account_id not in cards:
        raise HTTPException(400, "Le renouvellement automatique se paie avec une carte bancaire enregistrée sur PayByPhone.")


def check_offer(s):
    """Online, nothing is renewed or programmed without an offer chosen (the paywall), nor while blocked."""
    state = billing_state(guarded(lambda: load_account(s)), owner_id(s.username))
    if state in BLOCKED_STATES:
        raise HTTPException(402, "Compte bloqué : débloquez-le (bandeau en haut de page) pour activer un "
                                 "renouvellement.")
    if state == "trial":
        raise HTTPException(402, "Choisissez votre offre pour activer le renouvellement : rien n'est prélevé "
                                 "avant la fin de votre mois offert.")


@app.post("/api/autopilots")
def add_autopilot(body: Autopilot, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    if not body.email.strip():  # confirmations go to the account e-mail by default
        try:
            body.email = load_account(s).get("email") or ""
        except Exception as e:
            log.warning("account e-mail unreadable: %s", e)
    days, start = checked_days(body)
    # Only the account's own vehicles (they are what the subscription bills).
    own = {plate_key(v.get("licensePlate") or "") for v in guarded(lambda: s.call("get_vehicles")) or []
           if not v.get("archived")}
    if plate_key(body.plate) not in own:
        raise HTTPException(400, "Ce véhicule n'est pas sur votre compte PayByPhone : ajoutez-le d'abord dans l'application.")
    # One renewal per vehicle: two would each pay for the same car.
    if plate_key(body.plate) in guarded(lambda: renewed_plates(s)):
        raise HTTPException(409, "Ce véhicule a déjà un renouvellement automatique.")
    check_card(s, body.paymentAccountId)
    if HOSTED and not s.demo:
        refresh = getattr(s.bot, "refresh_token", None)
        if not refresh:
            raise HTTPException(401, "Reconnectez-vous pour activer le renouvellement automatique.")
        check_offer(s)
        guarded(lambda: ensure_covered(s, body.plate))

        def save():
            row = store("renewal_save", p_row={
                "owner": owner_id(s.username), "credential": encrypt_credential(refresh),
                "data": encrypt_details({"label": body.label, "plate": body.plate, "location": body.location,
                                         "rate": body.rate, "duration": fmt_qty(body.duration), "unit": body.unit,
                                         "payment_account_id": body.paymentAccountId,
                                         "email": body.email.strip(), "days": days, "start": start,
                                         **({"tz": body.tz} if days and body.tz else {}),
                                         **({"date_from": body.dateFrom, "date_to": body.dateTo} if days and body.dateFrom else {}),
                                         **({"cmis_attested_at": utc_iso(datetime.now(timezone.utc))} if body.cmis else {})})})
            # Paid below, in this request: the scheduler keeps off the new row meanwhile (never two payments at once).
            store("renewal_update", p_id=row["id"],
                  p_patch={"next_check": utc_iso(datetime.now(timezone.utc) + timedelta(minutes=10))})
            row = {**row, "owner": owner_id(s.username)}  # its stored login is the fallback if this one is stale
            details = {**with_details(row)}
            before = running_for(s, body.plate)
            outcome = process_renewal(row, refresh_token=refresh, activating=True)  # pay now if it is due
            stored = next((r for r in store("renewal_list", p_owner=owner_id(s.username)) if r["id"] == row["id"]), row)
            message = None
            if outcome in ("paid", "active", "waiting"):
                active = running_for(s, body.plate)
                rule = rule_of(details)
                case, expire, next_payment = (None, None, None) if rule else activation_case(outcome, before, active,
                                                                                            details)
                message = activation_message(case, expire, next_payment) if case else None
                notify(details, "activated", expire=covered_until(active) if active else None, message=message,
                       next=schedule.next_ticket(rule, datetime.now(timezone.utc)) if rule else None)
            follow_renewals(s)
            answer = with_next_ticket(stored_to_autopilot(stored))
            record_activity("Ticket programmé" if days else "Renouvellement résident activé", s,
                         ["Véhicule %s***, zone %s." % (body.plate[:2], body.location)])
            if message:
                answer["activation"] = {"title": message[0], "text": message[1], "payYourself": PAY_YOURSELF}
            elif outcome in ("unconfirmed", "not_payable", "error", "relogin", "blocked", "unreadable"):
                # Paying now failed while the customer is on the page: say it there, they pay this ticket themselves.
                answer["activation"] = {"failed": True, "title": "Le paiement n'a pas abouti.",
                                        "text": stored.get("last_error") or UNCONFIRMED,
                                        "payYourself": "Payez vous-même votre ticket dans l'application PayByPhone : "
                                                       "tant que ce ne sera pas fait, votre véhicule ne sera pas "
                                                       "couvert."}
            return answer

        return guarded(save)
    ap = {**body.model_dump(), "duration": fmt_qty(body.duration), "id": uuid.uuid4().hex[:8], "enabled": True,
          "lastCheck": None, "lastPayment": None, "lastError": None, "days": days, "start": start}
    s.autopilots[ap["id"]] = ap
    if HOSTED:  # demo on a serverless host: no background thread, run it now
        run_autopilot(s, ap)
    else:
        threading.Thread(target=lambda: guarded(lambda: run_autopilot(s, ap)), daemon=True).start()
    return ap


@app.get("/api/account")
def get_account(pbb_session: str = Cookie(None)):
    s = current(pbb_session)

    def load():
        account = load_account(s)
        if account.get("trial_start") and not account.get("trial_kept") and not account.get("stripe_subscription"):
            # Started at sign-up under the old rule, without an offer chosen: it now starts with the offer.
            account = save_account(s, {"trial_start": None, "trial_kept": True})
        return account

    account = guarded(load)
    start = parse_dt(account.get("trial_start"))
    state, grace_end = billing_status(account, owner_id(s.username)) if HOSTED and not s.demo else ("ok", None)
    return {"email": account.get("email") or "", "zone": account.get("zone") or None,
            "trialEnd": (start + timedelta(days=TRIAL_DAYS)).isoformat() if start else None,
            # Not started yet: the free month the offer screen promises (it starts when the offer is chosen).
            "trialDays": TRIAL_DAYS if not start else None,
            "plan": subscription_plan(account),
            # 'grace': a charge was refused, renewals go on until graceEnd. Renewals stop while blocked:
            # 'unpaid' (still not paid after the grace week) or 'trialOver' (no subscription).
            "blocked": {"grace": "grace", "unpaid": "unpaid", "trial_over": "trialOver"}.get(state),
            "graceEnd": grace_end.isoformat() if grace_end else None,
            # A renewal is activated only with a subscription, chosen even during the free month.
            "subscribed": state in ("ok", "grace"),
            "suvPlates": list(account.get("suv_plates") or [])}


class SuvChoice(BaseModel):
    plate: str = Field(max_length=20)
    suv: bool


@app.put("/api/vehicles/suv")
def set_suv(body: SuvChoice, pbb_session: str = Cookie(None)):
    """« Mon véhicule est un SUV »: PayByPhone does not tell, the user ticks it; the price follows (from the next
    billing date for a running subscription)."""
    s = current(pbb_session)
    key = plate_key(body.plate)
    suvs = set(guarded(lambda: load_account(s)).get("suv_plates") or [])
    suvs = suvs | {key} if body.suv else suvs - {key}
    guarded(lambda: save_account(s, {"suv_plates": sorted(suvs)}))
    found = guarded(lambda: account_pricing(s))
    return found or {"zone": None, "monthly": None, "yearly": None}


class Checkout(BaseModel):
    plan: str = Field(pattern="^(monthly|yearly)$")
    plates: list[str] = Field(default_factory=list, max_length=50)  # the vehicles chosen on the offer screen


class CheckoutDone(BaseModel):
    session_id: str = Field(pattern=r"^cs_[A-Za-z0-9_]{10,200}$")


ACTIVE_STATUSES = ("trialing", "active", "past_due")
PLANS = {"monthly": ("month", "PayByBot · Mensuel"), "yearly": ("year", "PayByBot · Annuel")}  # price: plan_total


def stripe(method, path, **data):
    """Stripe REST API (form-encoded), with the key from STRIPE_SECRET_KEY."""
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        raise HTTPException(503, "Le paiement en ligne arrive très bientôt. Profitez de votre mois offert !")
    r = requests.request(method, "https://api.stripe.com/v1/" + path, auth=(key, ""), data=data or None,
                         timeout=15)
    if not r.ok:
        log.warning("stripe %s %s: %s %s", method, path.split("/")[0], r.status_code, r.text[:200])
        raise HTTPException(502, "Le paiement est momentanément indisponible. Réessayez dans un instant.")
    return r.json()


def subscription_plan(account):
    """The live plan from Stripe ('monthly' / 'yearly'), or None when there is no running subscription."""
    sub_id = account.get("stripe_subscription")
    if not sub_id or not os.environ.get("STRIPE_SECRET_KEY"):
        return None
    try:
        sub = stripe("GET", "subscriptions/" + sub_id)
    except HTTPException:
        return account.get("plan")  # Stripe unreachable: trust the last known plan
    return account.get("plan") if sub.get("status") in ACTIVE_STATUSES else None


PAID_STATUSES = ("trialing", "active")
UNPAID_STATUSES = ("past_due", "unpaid", "incomplete")
BLOCKED_STATES = ("unpaid", "trial_over")
GRACE_DAYS = 7  # after a refused charge, renewals keep going this long while the customer fixes the card
DUNNING_DAYS = (0, 3, 6, 7)  # days after the refused charge an e-mail goes out; the last says renewals stopped
BLOCKED = ("Compte bloqué : l'abonnement PayByBot n'est pas réglé. Le ticket en cours reste valable, le suivant "
           "ne sera pas payé.")
UNLOCK_TTL = 30 * 86400  # how long the "Débloquer mon compte" link of an e-mail works


def admin_owners():
    admins = [x.strip() for x in os.environ.get("PAYBYBOT_ADMINS", "").split(",") if x.strip()]
    return {owner_id(c) for a in admins for c in login_candidates(a)}


def unpaid_since(invoice):
    """When Stripe first tried to charge the invoice it could not collect (its finalization), or None."""
    if not isinstance(invoice, dict):
        return None
    at = (invoice.get("status_transitions") or {}).get("finalized_at") or invoice.get("created")
    return datetime.fromtimestamp(at, timezone.utc) if at else None


def billing_status(account, owner=None):
    """(state, end of the grace week or None). State: 'ok' (subscribed), 'trial' (free month running), 'grace'
    (Stripe could not charge less than GRACE_DAYS ago: renewals go on), or a blocked state: 'unpaid' (still not
    paid after the grace week) or 'trial_over' (free month ended without a subscription)."""
    if not account or (owner and owner in admin_owners()):
        return "ok", None  # the site owner, and renewals stored before accounts existed
    sub_id = account.get("stripe_subscription")
    if sub_id and os.environ.get("STRIPE_SECRET_KEY"):
        try:
            sub = stripe("GET", "subscriptions/" + sub_id + "?expand[]=latest_invoice")
        except HTTPException:
            sub = {"status": "active" if account.get("plan") else None}  # Stripe unreachable: trust the last plan
        status = sub.get("status")
        if status in PAID_STATUSES:
            return "ok", None
        if status in UNPAID_STATUSES:
            since = unpaid_since(sub.get("latest_invoice"))
            end = since + timedelta(days=GRACE_DAYS) if since else None
            return ("grace" if end and end > datetime.now(timezone.utc) else "unpaid"), end
    # Paid on Stripe Checkout but the return to PayByBot never happened (tab closed): found and recorded, during
    # the free month too, so the offer is never asked (and paid) twice. Looked up only after a Checkout was opened.
    if owner and not sub_id and account.get("checkout_at") and os.environ.get("STRIPE_SECRET_KEY") \
            and recover_subscription(account, owner):
        return "ok", None
    start = parse_dt(account.get("trial_start"))
    if not start or start + timedelta(days=TRIAL_DAYS) > datetime.now(timezone.utc):
        return "trial", None  # no start yet: the free month begins when the account is first opened
    if owner and not sub_id and os.environ.get("STRIPE_SECRET_KEY") and recover_subscription(account, owner):
        return "ok", None
    return "trial_over", None


def recover_subscription(account, owner):
    """A subscription paid on Stripe Checkout whose return page never loaded: found by its owner metadata, then
    recorded on the account so it is not looked up again."""
    try:
        found = stripe("GET", "subscriptions/search?query=" + requests.utils.quote(
            "metadata['owner']:'%s'" % owner)).get("data") or []
    except HTTPException:
        return False
    live = [x for x in found if x.get("status") in PAID_STATUSES + UNPAID_STATUSES]
    if not live:
        return False
    sub = live[0]
    interval = ((((sub.get("items") or {}).get("data") or [{}])[0].get("price") or {}).get("recurring") or {}).get("interval")
    save_account_by_owner(owner, {"stripe_subscription": sub["id"], "stripe_customer": sub.get("customer"),
                                  "plan": (sub.get("metadata") or {}).get("plan") or
                                          ("yearly" if interval == "year" else "monthly"), **trial_started(account)})
    log.info("subscription recovered from Stripe (return page missed)")
    return sub.get("status") in PAID_STATUSES


def billing_state(account, owner=None):
    return billing_status(account, owner)[0]


def guarded_state(owner):
    """billing_state for the scheduler: never blocks a renewal because a lookup failed."""
    try:
        return billing_state(account_by_owner(owner), owner)
    except Exception as e:
        log.warning("billing state unavailable: %s", str(e)[:200])
        return "ok"


def unlock_link(owner):
    """Signed link of the e-mail: straight to the right Stripe page, without logging in."""
    token = _fernet("unlock").encrypt(owner.encode()).decode()
    return APP_URL.rstrip("/") + "/api/billing/unlock?t=" + token


def notify_blocked(details, state):
    """One e-mail when a renewal is blocked for lack of payment, with the way out."""
    to = account_by_owner(details["owner"]).get("email") or details.get("email")
    if not to:
        return
    car = "%s, zone %s" % (plate_text(details.get("plate")), details.get("location"))
    first = ("Le dernier paiement de votre abonnement PayByBot n'a pas abouti : votre compte est bloqué."
             if state == "unpaid" else
             "Votre mois offert est terminé et aucun abonnement n'est en cours : votre compte est bloqué.")
    send_email(to, "Compte PayByBot bloqué · paiement requis",
               "Paiement refusé : compte bloqué" if state == "unpaid" else "Votre compte est bloqué",
               [first,
                "Votre ticket en cours reste valable jusqu'à sa fin, mais le renouvellement suivant pour %s "
                "n'aura pas lieu." % car,
                "Débloquez votre compte : le renouvellement reprend tout seul dès que le paiement est fait."],
               ("Débloquer mon compte", unlock_link(details["owner"])),
               footer="Vous recevez cet e-mail parce que vous avez un renouvellement automatique sur PayByBot.")


def subscription_owner(sub):
    """The PayByBot owner a subscription belongs to: its metadata, else the Checkout session that created it (then
    written on the subscription for next time)."""
    owner = (sub.get("metadata") or {}).get("owner")
    if owner:
        return owner
    found = stripe("GET", "checkout/sessions?limit=1&subscription=" + sub["id"]).get("data") or []
    owner = found[0].get("client_reference_id") if found else None
    if owner:
        stripe("POST", "subscriptions/" + sub["id"], **{"metadata[owner]": owner})
    return owner


def notify_unpaid(to, link, step, end):
    """The e-mails of the grace week (see DUNNING_DAYS), each with the link to pay."""
    left = GRACE_DAYS - step
    deadline = paris_text(end)
    button = ("Régulariser mon paiement", link)
    footer = "Vous recevez cet e-mail parce que vous avez un abonnement PayByBot."
    if step >= GRACE_DAYS:
        send_email(to, "Renouvellement PayByBot arrêté · paiement requis", "Renouvellement arrêté",
                   ["Le paiement de votre abonnement PayByBot n'a pas été régularisé : le renouvellement automatique "
                    "est arrêté.",
                    "Votre ticket en cours reste valable jusqu'à sa fin, mais le suivant ne sera pas payé.",
                    "Régularisez : le renouvellement reprend tout seul dès que le paiement est fait."],
                   button, footer=footer)
        return
    if step == 0:
        subject, title = "Paiement PayByBot refusé · mettez à jour votre carte", "Votre paiement n'est pas passé"
        first = ("Le prélèvement de votre abonnement PayByBot a été refusé (carte expirée, opposition ou plafond "
                 "atteint, par exemple).")
    elif left > 1:
        subject, title = "Rappel · paiement PayByBot en attente", "Plus que %d jours pour régulariser" % left
        first = "Le paiement de votre abonnement PayByBot est toujours en attente."
    else:
        subject, title = "Dernier jour · paiement PayByBot en attente", "Dernier jour pour régulariser"
        first = "Le paiement de votre abonnement PayByBot est toujours en attente."
    send_email(to, subject, title,
               [first,
                "Vos renouvellements continuent jusqu'au %s. Sans paiement d'ici là, ils s'arrêteront." % deadline,
                "Mettez à jour votre carte en un clic : le paiement est fait aussitôt."],
               button, footer=footer)


def dun(sub, now):
    """One failing subscription: send the grace-week e-mail due today, if not sent yet."""
    invoice = sub.get("latest_invoice")
    since = unpaid_since(invoice)
    owner = subscription_owner(sub) if since else None
    if not owner:
        return
    account = account_by_owner(owner)
    if account.get("stripe_subscription") != sub["id"] or not account.get("email"):
        return
    due = [d for d in DUNNING_DAYS if d <= (now - since).days]
    if not due:
        return
    dunning = account.get("dunning") or {}
    if dunning.get("invoice") != invoice["id"]:
        dunning = {"invoice": invoice["id"], "sent": []}
    if due[-1] in dunning["sent"]:
        return
    notify_unpaid(account["email"], unlock_link(owner), due[-1], since + timedelta(days=GRACE_DAYS))
    save_account_by_owner(owner, {"dunning": {**dunning, "sent": dunning["sent"] + [due[-1]]}})
    log.info("grace-week e-mail sent (day %d)", due[-1])


def run_dunning():
    """The subscriptions Stripe could not charge, each with the e-mail of its grace-week day. Never raises."""
    if not os.environ.get("STRIPE_SECRET_KEY"):
        return 0
    now, count = datetime.now(timezone.utc), 0
    for status in ("past_due", "unpaid"):
        try:
            subs = stripe("GET", "subscriptions?limit=100&expand[]=data.latest_invoice&status=" + status).get("data")
        except Exception as e:
            log.warning("dunning: subscriptions unavailable: %s", str(e)[:200])
            continue
        for sub in subs or []:
            try:
                dun(sub, now)
                count += 1
            except Exception as e:
                log.warning("dunning failed for one subscription: %s", str(e)[:200])
    return count


def checkout_url(owner, account, plan, success_url):
    """A Stripe Checkout page for the plan; while the free month runs, the first charge waits for its end."""
    base = APP_URL.rstrip("/")
    interval, name = PLANS[plan]
    monthlies = account_monthlies(account)
    amount = plan_total(monthlies, plan)
    data = {"mode": "subscription", "line_items[0][quantity]": 1,
            "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": amount,
            "line_items[0][price_data][recurring][interval]": interval,
            "line_items[0][price_data][product_data][name]": name,
            "client_reference_id": owner, "metadata[plan]": plan, "subscription_data[metadata][owner]": owner,
            "metadata[monthlies]": ",".join(str(m) for m in monthlies),
            "success_url": success_url,
            "cancel_url": base + "/#/",  # Stripe's back arrow: back to the dashboard
            "locale": "fr", "allow_promotion_codes": "true",
            # A simple page: euros only (no currency switch) and cards only (Apple Pay / Google Pay included,
            # no Klarna or Revolut Pay).
            "adaptive_pricing[enabled]": "false", "payment_method_types[0]": "card",
            # PayByBot's own look on Stripe's page, without changing the Studio Presto account branding.
            "branding_settings[display_name]": "PayByBot",
            "branding_settings[logo][type]": "url", "branding_settings[logo][url]": base + "/brand/paybybot-logo.png",
            "branding_settings[button_color]": "#1d4ea3", "branding_settings[font_family]": "inter",
            "branding_settings[border_style]": "rounded"}
    if account.get("stripe_customer"):
        data["customer"] = account["stripe_customer"]
    elif account.get("email"):
        data["customer_email"] = account["email"]
    start = parse_dt(account.get("trial_start"))
    # The free month runs from the day the offer is chosen (today when it has not started yet).
    trial_end = (start or datetime.now(timezone.utc)) + timedelta(days=TRIAL_DAYS)
    if trial_end > datetime.now(timezone.utc) + timedelta(hours=1):
        # The free month is already running: no Stripe "trial" (its page would offer to start one); the first
        # charge is simply set on the day the free month ends, nothing being due before.
        data["subscription_data[billing_cycle_anchor]"] = int(trial_end.timestamp())
        data["subscription_data[proration_behavior]"] = "none"
        months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
                  "novembre", "décembre"]
        day = trial_end.astimezone(PARIS)
        data["custom_text[submit][message]"] = (
            "Rien n'est prélevé avant la fin de votre mois offert, le %d %s." % (day.day, months[day.month - 1]))
    return stripe("POST", "checkout/sessions", **data)["url"]


def unlock_url(owner, account, plan="monthly"):
    """Where to pay to unblock: the open invoice when Stripe failed to charge, else a new subscription."""
    sub_id = account.get("stripe_subscription")
    if sub_id:
        sub = stripe("GET", "subscriptions/" + sub_id)
        if sub.get("status") in UNPAID_STATUSES:
            invoice = stripe("GET", "invoices/" + sub["latest_invoice"]) if sub.get("latest_invoice") else {}
            if invoice.get("status") == "open" and invoice.get("hosted_invoice_url"):
                return invoice["hosted_invoice_url"]
            return stripe("POST", "billing_portal/sessions", customer=account["stripe_customer"],
                          return_url=APP_URL.rstrip("/") + "/", configuration=portal_configuration())["url"]
    return checkout_url(owner, account, plan,
                        APP_URL.rstrip("/") + "/api/billing/unlocked?session_id={CHECKOUT_SESSION_ID}")


def resume_renewals(owner):
    """Paid again: check the owner's renewals now instead of waiting for the next look."""
    for row in store("renewal_list", p_owner=owner):
        store("renewal_update", p_id=row["id"], p_patch={"next_check": utc_iso(datetime.now(timezone.utc))})


def active_product(plan):
    """The Stripe product a repriced subscription item points to: an active one (the product of a Checkout's inline
    price is created inactive, and Stripe refuses a new price on it)."""
    found = stripe("GET", "products/search?query=" + requests.utils.quote(
        "active:'true' AND metadata['paybybot_plan']:'%s'" % plan)).get("data") or []
    if found:
        return found[0]["id"]
    return stripe("POST", "products", name=PLANS[plan][1], **{"metadata[paybybot_plan]": plan})["id"]


def reprice(account, owner):
    """The home zone's resident price changed (a move, a new city rate): the running subscription follows it from
    its next billing date, without proration. No e-mail: the Stripe receipt shows the new amount."""
    sub_id = account.get("stripe_subscription")
    if not (owner and sub_id and os.environ.get("STRIPE_SECRET_KEY")):
        return False
    monthlies, billed = account_monthlies(account), billed_monthlies(account)
    if billed is not None and sorted(billed) == sorted(monthlies):
        return False
    try:
        sub = stripe("GET", "subscriptions/" + sub_id)
        if sub.get("status") not in PAID_STATUSES + UNPAID_STATUSES:
            return False
        item = sub["items"]["data"][0]
        plan = account.get("plan") or ("yearly" if item["price"]["recurring"]["interval"] == "year" else "monthly")
        new = plan_total(monthlies, plan)
        if billed is None and item["price"].get("unit_amount") == new:  # already right, just not recorded
            save_account_by_owner(owner, {"billed_monthlies": monthlies})
            return False
        stripe("POST", "subscriptions/" + sub_id, **{
            "items[0][id]": item["id"], "items[0][price_data][currency]": "eur",
            "items[0][price_data][product]": active_product(plan),
            "items[0][price_data][unit_amount]": new,
            "items[0][price_data][recurring][interval]": item["price"]["recurring"]["interval"],
            "proration_behavior": "none", "metadata[monthlies]": ",".join(str(m) for m in monthlies)})
    except (HTTPException, KeyError, IndexError) as e:
        log.warning("reprice failed: %s", str(e)[:200])
        return False
    save_account_by_owner(owner, {"billed_monthlies": monthlies})
    log.info("subscription repriced (%s, %d vehicle(s))", plan, len(monthlies))
    return True


@app.get("/api/pricing")
def pricing(pbb_session: str = Cookie(None)):
    """The account's prices, by vehicle type and zone: per month, and per year with 20 % off. No riverain vehicle:
    zone and prices None."""
    s = current(pbb_session)
    found = guarded(lambda: account_pricing(s))
    if found:  # « resident » only says whether a vehicle has the resident rate: nothing is locked without one
        # billing: vehicles must be covered by a subscription (online only, never in the demo or the local app)
        return {**found, "resident": any(v["zone"] for v in found["vehicles"]), "billing": HOSTED and not s.demo}
    log.info("pricing without any vehicle: PayByPhone lists none for this account")
    status = guarded(lambda: resident_status(s))
    return {"zone": status["zone"], "monthly": None, "yearly": None, "resident": status["resident"]}


def resident_status(s):
    """Is the resident status active on PayByPhone for one of the vehicles, and in which arrondissement? Always found
    on PayByPhone, vehicle by vehicle (see vehicle_zones)."""
    found = vehicle_zones(s)
    if found:
        return {"zone": found[0][1], "resident": True}
    return {"zone": (find_home_zone(s, scan=False) or {}).get("zone"), "resident": False}


@app.get("/api/resident-status")
def resident_status_route(pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    return guarded(lambda: resident_status(s))


@app.post("/api/billing/checkout")
def billing_checkout(body: Checkout, request: Request, pbb_session: str = Cookie(None)):
    """Stripe Checkout for the monthly or yearly plan; nothing is charged before the free month ends."""
    s = current(pbb_session)
    if s.demo:
        raise HTTPException(400, "Le paiement n'est pas disponible en mode démo.")
    if not os.environ.get("STRIPE_SECRET_KEY"):
        raise HTTPException(503, "Le paiement en ligne arrive très bientôt. Profitez de votre mois offert !")
    found = guarded(lambda: account_pricing(s))
    if not found:
        raise HTTPException(400, "Ajoutez d'abord un véhicule sur votre compte PayByPhone.")
    if body.plates:  # the vehicles chosen on the offer screen: the subscription is for them (and any renewed one)
        known = {plate_key(v["plate"]) for v in found["vehicles"]}
        chosen = [k for k in dict.fromkeys(plate_key(p) for p in body.plates) if k in known]
        if not chosen:
            raise HTTPException(400, "Choisissez au moins un véhicule.")
        guarded(lambda: save_account(s, {"chosen_plates": chosen}))
        guarded(lambda: account_pricing(s))  # the monthly prices follow the choice
    account = guarded(lambda: load_account(s))
    # Already subscribed (or paid in a tab closed before coming back): no second subscription.
    if account.get("stripe_subscription") or (account.get("checkout_at")
                                              and recover_subscription(account, owner_id(s.username))):
        if billing_status(guarded(lambda: load_account(s)), owner_id(s.username))[0] in ("ok", "grace"):
            raise HTTPException(409, "Vous avez déjà un abonnement en cours : gérez-le depuis « Mon compte ».")
    guarded(lambda: save_account(s, {"checkout_at": int(time.time())}))
    url = checkout_url(owner_id(s.username), account, body.plan,
                       APP_URL.rstrip("/") + "/#/abonnement?session_id={CHECKOUT_SESSION_ID}")
    return {"url": url}


@app.get("/api/billing/unlock")
def billing_unlock(t: str = "", plan: str = "monthly"):
    """« Débloquer mon compte » from the e-mail: the signed link leads straight to Stripe."""
    try:
        owner = _fernet("unlock").decrypt(t.encode(), ttl=UNLOCK_TTL).decode()
    except Exception:
        return RedirectResponse(APP_URL.rstrip("/") + "/", 303)
    account = guarded(lambda: account_by_owner(owner))
    return RedirectResponse(unlock_url(owner, account, plan if plan in PLANS else "monthly"), 303)


@app.post("/api/billing/unlock")
def billing_unlock_signed_in(pbb_session: str = Cookie(None)):
    """The dashboard's « Débloquer mon compte » when Stripe failed to charge."""
    s = current(pbb_session)
    if s.demo:
        raise HTTPException(400, "Le paiement n'est pas disponible en mode démo.")
    owner = owner_id(s.username)
    return {"url": unlock_url(owner, guarded(lambda: load_account(s)))}


@app.get("/api/billing/unlocked")
def billing_unlocked(session_id: str = ""):
    """Back from the e-mail's Checkout (maybe signed out): record the subscription and resume at once."""
    home = APP_URL.rstrip("/")
    if not re.fullmatch(r"cs_[A-Za-z0-9_]{10,200}", session_id):
        return RedirectResponse(home + "/", 303)
    session = stripe("GET", "checkout/sessions/" + session_id)
    owner = session.get("client_reference_id")
    if session.get("status") != "complete" or not owner:
        return RedirectResponse(home + "/", 303)
    billed = monthlies_from(session.get("metadata"))
    guarded(lambda: save_account_by_owner(owner, {"plan": (session.get("metadata") or {}).get("plan"),
                                                  "stripe_customer": session.get("customer"),
                                                  "stripe_subscription": session.get("subscription"),
                                                  "billed_monthlies": billed}))
    guarded(lambda: resume_renewals(owner))
    log.info("account unblocked from the e-mail link")
    return RedirectResponse(home + "/#/debloque", 303)


@app.post("/api/billing/confirm")
def billing_confirm(body: CheckoutDone, pbb_session: str = Cookie(None)):
    """Back from Stripe Checkout: record the subscription on the account."""
    s = current(pbb_session)
    session = stripe("GET", "checkout/sessions/" + body.session_id)
    if session.get("client_reference_id") != owner_id(s.username) or session.get("status") != "complete":
        raise HTTPException(400, "Ce paiement n'a pas abouti.")
    plan = (session.get("metadata") or {}).get("plan")
    billed = monthlies_from(session.get("metadata"))
    before = guarded(lambda: load_account(s))
    started = trial_started(before)  # the free month starts now that the offer is chosen
    account = guarded(lambda: save_account(s, {"plan": plan, "stripe_customer": session.get("customer"),
                                               "stripe_subscription": session.get("subscription"),
                                               "billed_monthlies": billed, **started}))
    if started:  # kept even if the account is deleted later: one free month per person
        mark_trial(s, parse_dt(started["trial_start"]), account.get("email"))
    if HOSTED and not s.demo:
        guarded(lambda: resume_renewals(owner_id(s.username)))
    log.info("subscription started (%s)", plan)
    record_activity("Abonnement souscrit", s, ["Offre : %s." % ("annuelle" if plan == "yearly" else "mensuelle")])
    return {"plan": account.get("plan")}


def portal_configuration():
    """The customer portal settings, created once if the Stripe account has none yet."""
    found = stripe("GET", "billing_portal/configurations?is_default=true&limit=1").get("data") or []
    if found:
        return found[0]["id"]
    return stripe("POST", "billing_portal/configurations", **{
        "business_profile[headline]": "PayByBot : gérez votre abonnement",
        "features[invoice_history][enabled]": "true",
        "features[payment_method_update][enabled]": "true",
        "features[subscription_cancel][enabled]": "true",
        "features[subscription_cancel][mode]": "at_period_end",
    })["id"]


@app.post("/api/billing/portal")
def billing_portal(pbb_session: str = Cookie(None)):
    """Stripe's customer portal: change card or plan, see invoices, cancel."""
    s = current(pbb_session)
    account = guarded(lambda: load_account(s))
    if not account.get("stripe_customer"):
        raise HTTPException(400, "Aucun abonnement à gérer.")
    portal = stripe("POST", "billing_portal/sessions", customer=account["stripe_customer"],
                    return_url=APP_URL.rstrip("/") + "/", configuration=portal_configuration())
    return {"url": portal["url"]}


def own_subscription(s):
    """The signed-in account's Stripe subscription id, or a 400 when there is none."""
    account = guarded(lambda: load_account(s))
    sub_id = account.get("stripe_subscription")
    if s.demo or not sub_id or not os.environ.get("STRIPE_SECRET_KEY"):
        raise HTTPException(400, "Aucun abonnement à gérer.")
    return account, sub_id


def in_free_month(account):
    """PayByBot's free month: Stripe already says « active » (its first charge is delayed to the month's end)."""
    start = parse_dt(account.get("trial_start"))
    return bool(start and now_utc() < start + timedelta(days=TRIAL_DAYS))


def subscription_of(account):
    """(status, plan, next billing date, its card) of the running Stripe subscription, or None without one."""
    sub_id = account.get("stripe_subscription")
    if not sub_id or not os.environ.get("STRIPE_SECRET_KEY"):
        return None
    sub = stripe("GET", "subscriptions/" + sub_id)
    if sub.get("status") not in ACTIVE_STATUSES:
        return None
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    plan = "yearly" if ((item.get("price") or {}).get("recurring") or {}).get("interval") == "year" else "monthly"
    end = item.get("current_period_end") or sub.get("current_period_end")
    card = sub.get("default_payment_method")
    return (sub["status"], plan, datetime.fromtimestamp(end, timezone.utc) if end else now_utc(),
            card.get("id") if isinstance(card, dict) else card)


def charge_now(account, cents, description, card):
    """Charge the subscription's card at once (vehicles added): Checkout keeps the card on the subscription, not on
    the customer, so it is named. A refusal leaves nothing behind."""
    customer = account.get("stripe_customer")
    stripe("POST", "invoiceitems", customer=customer, amount=cents, currency="eur", description=description)
    invoice = stripe("POST", "invoices", customer=customer, pending_invoice_items_behavior="include",
                     auto_advance="false", **({"default_payment_method": card} if card else {}))
    try:
        stripe("POST", "invoices/%s/pay" % invoice["id"])
    except HTTPException:
        try:
            stripe("POST", "invoices/%s/void" % invoice["id"])
        except HTTPException:
            pass
        raise HTTPException(402, "Votre carte a été refusée : le véhicule n'a pas été ajouté. Changez de carte dans "
                                 "« Gérer », puis réessayez.")


def stop_renewals(s, plates):
    """Vehicles taken off the subscription: their renewals and programmed tickets stop (a running ticket stays)."""
    if HOSTED and not s.demo:
        owner = owner_id(s.username)
        for row in store("renewal_list", p_owner=owner) or []:
            try:
                if plate_key(with_details(row)["plate"]) in plates:
                    store("renewal_delete", p_owner=owner, p_id=row["id"])
            except Exception as e:
                log.warning("renewal %s: not stopped: %s", row.get("id"), type(e).__name__)
    else:
        for ap_id, ap in list(s.autopilots.items()):
            if plate_key(ap["plate"]) in plates:
                s.autopilots.pop(ap_id, None)


def plural(n, word):
    return word + ("s" if n > 1 else "")


class CoveredChange(BaseModel):
    plates: list[Annotated[str, Field(max_length=20)]] = Field(max_length=20)
    confirm: bool = False  # False: only what it would cost, nothing changed


@app.post("/api/account/vehicles")
def covered_vehicles(body: CoveredChange, pbb_session: str = Cookie(None)):
    """« Mon compte »: the vehicles the subscription covers. An added vehicle pays the month started at once (yearly:
    the months left); a removed one stops its renewal and, yearly, is credited the whole months after this one."""
    s = current(pbb_session)
    found = guarded(lambda: account_pricing(s)) or {}
    known = [plate_key(v["plate"]) for v in found.get("vehicles") or []]
    plates = [k for k in dict.fromkeys(plate_key(p) for p in body.plates) if k in known]
    if not plates:
        raise HTTPException(400, "Gardez au moins un véhicule : pour tout arrêter, résiliez l'abonnement.")
    old = {plate_key(p) for p in found.get("billed") or []}
    added, removed = [p for p in plates if p not in old], sorted(old - set(plates))
    stops = sorted(set(removed) & guarded(lambda: renewed_plates(s)))
    account = guarded(lambda: load_account(s))
    sub = guarded(lambda: subscription_of(account)) if HOSTED and not s.demo else None
    plan, end, months, charge, credit = account.get("plan") or "monthly", None, 0, 0, 0
    card = None
    if sub:
        status, plan, end, card = sub
        months = months_left(now_utc(), end)
        if status != "trialing" and not in_free_month(account):  # free month: the first payment covers them all
            charge, credit = change_cents(plan, months, len(added), len(removed))
    answer = {"plan": plan, "added": added, "removed": removed, "stops": stops, "chargeCents": charge,
              "creditCents": credit, "months": months, "total": plan_total([MONTHLY_PRICE] * len(plates), plan),
              "nextBilling": end.isoformat() if end else None}
    if not body.confirm:
        return answer
    if charge:
        charge_now(account, charge, "%s %s : %s, %d mois" % (
            plural(len(added), "Véhicule"), plural(len(added), "ajouté"), ", ".join(added), months), card)
    if credit:
        stripe("POST", "invoiceitems", customer=account.get("stripe_customer"), amount=-credit, currency="eur",
               description="%s %s : %s, %d mois crédités" % (
                   plural(len(removed), "Véhicule"), plural(len(removed), "retiré"), ", ".join(removed), months - 1))
    if stops:
        stop_renewals(s, set(stops))
    guarded(lambda: save_account(s, {"chosen_plates": plates}))
    guarded(lambda: account_pricing(s))  # the subscription follows these vehicles from its next billing date
    record_activity("Véhicules de l'abonnement modifiés", s, ["%d véhicule(s)." % len(plates)])
    mail_coverage(account.get("email"), answer, plates)
    return answer


def mail_coverage(to, change, plates):
    """The client's record of a change of the covered vehicles: what was added or removed, charged, credited."""
    euros = lambda cents: money_text({"amount": cents / 100})
    lines = []
    if change["added"]:
        lines.append("%s %s : %s." % (plural(len(change["added"]), "Véhicule"),
                                      plural(len(change["added"]), "ajouté"), ", ".join(change["added"])))
    if change["removed"]:
        lines.append("%s %s : %s." % (plural(len(change["removed"]), "Véhicule"),
                                      plural(len(change["removed"]), "retiré"), ", ".join(change["removed"])))
    if change["stops"]:
        lines.append("Renouvellement arrêté pour %s ; le ticket en cours reste valable." % ", ".join(change["stops"]))
    if change["chargeCents"]:
        lines.append("Prélevé aujourd'hui : %s (%s)." % (euros(change["chargeCents"]), "le mois en cours" if
                                                         change["months"] <= 1 else "le mois en cours et les %d suivants"
                                                         % (change["months"] - 1)))
    elif change["added"]:
        lines.append("Rien n'est prélevé pendant votre mois offert.")
    if change["creditCents"]:
        lines.append("Crédité sur votre prochaine facture : %s. Le mois en cours reste dû." % euros(change["creditCents"]))
    when = parse_dt(change.get("nextBilling"))
    lines.append("Votre abonnement couvre maintenant %d véhicule%s : %s%s%s." % (
        len(plates), "s" if len(plates) > 1 else "", euros(change["total"]),
        " par an" if change["plan"] == "yearly" else " par mois",
        " à partir du %d %s" % (when.day, MONTH_NAMES[when.month - 1]) if when else ""))
    send_email(to, "Votre abonnement PayByBot a changé", "Votre abonnement a changé", lines,
               ("Ouvrir PayByBot", APP_URL),
               footer="Vous recevez cet e-mail parce que les véhicules de votre abonnement PayByBot ont changé.")


def ensure_covered(s, plate):
    """No renewal, programmed ticket or ticket from PayByBot for a vehicle the subscription does not cover. During
    the free month it is simply added; after it, the client adds it first and pays the month started."""
    if not HOSTED or s.demo:
        return
    found = account_pricing(s) or {}
    billed = [plate_key(p) for p in found.get("billed") or []]
    key = plate_key(plate)
    if key in billed:
        return
    account = load_account(s)
    sub = subscription_of(account)
    if not sub:  # no subscription yet: check_offer asks for one first
        return
    status, plan, end, _ = sub
    if status == "trialing" or in_free_month(account):
        save_account(s, {"chosen_plates": billed + [key]})
        account_pricing(s)
        plates = billed + [key]
        mail_coverage(account.get("email"), {"added": [key], "removed": [], "stops": [], "chargeCents": 0,
                                             "creditCents": 0, "months": 0, "plan": plan, "nextBilling": end.isoformat(),
                                             "total": plan_total([MONTHLY_PRICE] * len(plates), plan)}, plates)
        return
    cents = change_cents(plan, months_left(now_utc(), end), 1, 0)[0]
    raise HTTPException(402, {"code": "not_covered", "plate": key, "cents": cents,
                              "message": "Ce véhicule n'est pas dans votre abonnement : ajoutez-le d'abord (%s)."
                                         % money_text({"amount": cents / 100})})


@app.get("/api/billing/subscription")
def billing_subscription(pbb_session: str = Cookie(None)):
    """« Mon abonnement », inside PayByBot: offer, price, next billing date, card, last invoices."""
    s = current(pbb_session)
    account, sub_id = own_subscription(s)
    sub = stripe("GET", "subscriptions/" + sub_id + "?expand[]=default_payment_method"
                 "&expand[]=customer.invoice_settings.default_payment_method")
    item = (sub.get("items") or {}).get("data", [{}])[0]
    price = item.get("price") or {}
    method = sub.get("default_payment_method") or \
        (((sub.get("customer") or {}).get("invoice_settings") or {}).get("default_payment_method")) or {}
    card = method.get("card") or {}
    period_end = item.get("current_period_end") or sub.get("current_period_end")
    invoices = stripe("GET", "invoices?limit=6&subscription=" + sub_id).get("data") or []
    return {
        "plan": "yearly" if (price.get("recurring") or {}).get("interval") == "year" else "monthly",
        "amount": price.get("unit_amount"),
        "status": sub.get("status"),
        "nextBilling": datetime.fromtimestamp(period_end, timezone.utc).isoformat() if period_end else None,
        "cancelAtPeriodEnd": bool(sub.get("cancel_at_period_end")),
        "card": {"brand": card.get("brand"), "last4": card.get("last4"), "expMonth": card.get("exp_month"),
                 "expYear": card.get("exp_year")} if card else None,
        "invoices": [{"date": datetime.fromtimestamp(i["created"], timezone.utc).isoformat(), "amount": i.get("amount_paid"),
                      "status": i.get("status"), "url": i.get("hosted_invoice_url")}
                     for i in invoices if i.get("status") in ("paid", "open")],
    }


class CancelChoice(BaseModel):
    cancel: bool


@app.post("/api/billing/cancel")
def billing_cancel(body: CancelChoice, pbb_session: str = Cookie(None)):
    """Cancel at the end of the period already paid (or take it back before then)."""
    s = current(pbb_session)
    _, sub_id = own_subscription(s)
    stripe("POST", "subscriptions/" + sub_id, cancel_at_period_end="true" if body.cancel else "false")
    log.info("subscription %s at period end", "cancelled" if body.cancel else "kept")
    record_activity("Abonnement résilié" if body.cancel else "Résiliation annulée", s)
    return billing_subscription(pbb_session)


@app.post("/api/billing/card")
def billing_card(pbb_session: str = Cookie(None)):
    """Change the card: Stripe's secure page, opened on that step only, then back to PayByBot."""
    s = current(pbb_session)
    account, _ = own_subscription(s)
    portal = stripe("POST", "billing_portal/sessions", customer=account["stripe_customer"],
                    return_url=APP_URL.rstrip("/") + "/", configuration=portal_configuration(),
                    **{"flow_data[type]": "payment_method_update",
                       "flow_data[after_completion][type]": "redirect",
                       "flow_data[after_completion][redirect][return_url]": APP_URL.rstrip("/") + "/"})
    return {"url": portal["url"]}


@app.put("/api/account")
def update_account(body: AccountPatch, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    check_email(body.email)
    if body.email and not s.demo and email_taken(body.email, owner_id(s.username)):
        raise HTTPException(400, EMAIL_TAKEN)
    # The e-mail only: the arrondissement is never typed, it comes from PayByPhone for each vehicle.
    patch = {k: v.strip() for k, v in body.model_dump().items() if v is not None and k != "zone"}
    account = guarded(lambda: save_account(s, patch))
    return {"email": account.get("email") or "", "zone": account.get("zone") or None}


def is_admin(s):
    """The site owner: PayByPhone accounts listed in PAYBYBOT_ADMINS (phone numbers, comma separated)."""
    admins = [x.strip() for x in os.environ.get("PAYBYBOT_ADMINS", "").split(",") if x.strip()]
    return not s.demo and any(owner_id(c) == owner_id(s.username) for a in admins for c in login_candidates(a))


# The owner's admin page has its own login (e-mail + password), separate from PayByPhone.
# PAYBYBOT_ADMIN_EMAIL, and PAYBYBOT_ADMIN_PASSWORD_HASH made by scripts/admin_password.py (never the password).
ADMIN_COOKIE = "pbb_admin"
ADMIN_SESSION = 12 * 3600


def password_matches(password, stored):
    """stored = "pbkdf2_sha256$<iterations>$<salt hex>$<hash hex>"."""
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        computed = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(computed.hex(), digest)
    except Exception:
        return False


class AdminLogin(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    turnstile: str = Field(default="", max_length=2048)


@app.post("/api/admin/login")
def admin_login(body: AdminLogin, request: Request, response: Response):
    email, stored = os.environ.get("PAYBYBOT_ADMIN_EMAIL", ""), os.environ.get("PAYBYBOT_ADMIN_PASSWORD_HASH", "")
    if not HOSTED or not email or not stored:
        raise HTTPException(403, "Accès admin non configuré.")
    check_human(request, body.turnstile)
    ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    key = hmac.new(_subkey(_secrets()[0], "rate"), ip.encode(), hashlib.sha256).hexdigest()
    if not store("rate_hit", p_key="admin:" + key, p_window_seconds=900, p_max=5):
        raise HTTPException(429, "Trop de tentatives. Réessayez dans 15 minutes.")
    ok_email = hmac.compare_digest(body.email.strip().lower(), email.strip().lower())
    if not (password_matches(body.password, stored) and ok_email):
        log.warning("admin login refused")
        raise HTTPException(401, "Identifiants incorrects.")
    response.set_cookie(ADMIN_COOKIE, _fernet("admin").encrypt(b"admin").decode(), httponly=True, samesite="strict",
                        secure=True, path="/api/admin", max_age=ADMIN_SESSION)
    log.info("admin login ok")
    return {"ok": True}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE, path="/api/admin")
    return {"ok": True}


def require_admin(value):
    try:
        if _fernet("admin").decrypt((value or "").encode(), ttl=ADMIN_SESSION) == b"admin":
            return
    except Exception:
        pass
    raise HTTPException(401, "Connexion admin requise.")


@app.get("/api/admin/stats")
def admin_stats(pbb_admin: str = Cookie(None)):
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    return guarded(lambda: store("admin_stats"))


@app.get("/api/history")
def history(pbb_session: str = Cookie(None)):
    """The weeks already paid, from PayByPhone (running and past tickets of five days or more), newest first. An
    extended ticket is one line covering all its weeks."""
    s = current(pbb_session)

    def load():
        try:
            past = s.call("get_past_sessions", limit=40) or []
        except Exception as e:
            log.info("history unavailable: %s", type(e).__name__)
            past = []
        rows, seen = [], set()
        for x in (s.call("get_parking_sessions") or []) + past:
            start, end = x.get("startTime"), x.get("expireTime")
            if x.get("parkingSessionId") in seen or not (start and end) or end - start < timedelta(days=5):
                continue
            seen.add(x.get("parkingSessionId"))
            rows.append(serialize_session(x))
        rows.sort(key=lambda r: r["start"] or "", reverse=True)
        return rows[:20]

    return guarded(load)


@app.get("/api/zones/recent")
def recent_zones(pbb_session: str = Cookie(None)):
    """The zones the user already parked in on PayByPhone, most recent first (suggested when typing a zone)."""
    s = current(pbb_session)

    def load():
        try:
            sessions = (s.call("get_parking_sessions") or []) + (s.call("get_past_sessions", limit=40) or [])
        except Exception as e:
            log.info("recent zones unavailable: %s", type(e).__name__)
            return []
        sessions.sort(key=lambda x: x.get("startTime") or datetime.min, reverse=True)
        zones = dict.fromkeys(str(x.get("locationId")) for x in sessions if x.get("locationId"))
        return list(zones)[:10]

    return guarded(load)


class ServiceAction(BaseModel):
    action: str = Field(pattern="^(interrupt|notify|resume)$")


@app.get("/api/admin/service")
def admin_service(pbb_admin: str = Cookie(None)):
    """The interruption state and how many customers the e-mail would reach."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    state = guarded(lambda: store("service_state_get")) or {}
    return {**state, "recipients": len(guarded(outage_recipients))}


@app.post("/api/admin/service")
def admin_service_action(body: ServiceAction, pbb_admin: str = Cookie(None)):
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    return guarded(lambda: service_action(body.action))


class BackupAccount(BaseModel):
    login: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=1, max_length=200)


def backup_status(state):
    """The backup account as the admin page shows it: never its login token."""
    week = parse_dt((state or {}).get("week_start"))
    spent = ((state or {}).get("week_cents") or 0) if week and datetime.now(timezone.utc) - week < timedelta(days=7) else 0
    return {"connected": bool((state or {}).get("credential")), "label": (state or {}).get("label"),
            "weekCents": spent, "capCents": BACKUP_WEEKLY_CAP_CENTS}


@app.get("/api/admin/backup-account")
def admin_backup_account(pbb_admin: str = Cookie(None)):
    """The owner's PayByPhone account that advances a ticket when a client's card fails."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    return backup_status(guarded(lambda: store("backup_account_get")))


@app.post("/api/admin/backup-account")
def admin_backup_account_set(body: BackupAccount, pbb_admin: str = Cookie(None)):
    """The owner logs in their backup account once: only its PayByPhone token is kept, encrypted, never the password."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    try:
        bot, used = connect(body.login, body.password)
    except requests.HTTPError:
        raise HTTPException(400, "PayByPhone refuse cet identifiant ou ce mot de passe.")
    cards = [p["label"] for p in normalize_accounts(bot.get_payment_accounts() or {})
             if p["kind"] == "card" and not p["expired"]]
    if not cards:
        raise HTTPException(400, "Ajoutez d'abord votre carte de secours dans ce compte PayByPhone.")
    label = used[:4] + "•••" + used[-2:]
    store("backup_account_set", p_credential=encrypt_credential(bot.refresh_token), p_label=label)
    return {"connected": True, "label": label, "cards": cards}


@app.delete("/api/admin/backup-account")
def admin_backup_account_delete(pbb_admin: str = Cookie(None)):
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    store("backup_account_set", p_credential=None, p_label=None)
    return {"connected": False}


_admin_parking = {}  # owner -> (when read, its vehicles and running tickets, its cards' end dates)


def card_dates(accounts):
    """A client's cards for the owner's page: when they end, nothing that identifies them."""
    for card in accounts.get("paymentCards") or []:  # how the masked number looks, never its digits
        masked = card.get("maskedCardNumber") or ""
        log.info("admin: card mask length=%s digits=%s", len(masked), sum(c.isdigit() for c in masked))
    return [{"exp": p["label"].split(" — exp. ")[-1] if p["validUntil"] else None, "validUntil": p["validUntil"],
             "expired": p["expired"]} for p in normalize_accounts(accounts) if p["kind"] == "card"]


@app.get("/api/admin/activity")
def admin_activity(pbb_admin: str = Cookie(None)):
    """The owner's « Activité »: what users did lately (sign-ups, sign-ins, renewals…), newest first."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    return guarded(lambda: activity_rows()) or []


@app.delete("/api/admin/activity")
@app.delete("/api/admin/activity/{activity_id}")
def admin_activity_delete(activity_id: int | None = None, pbb_admin: str = Cookie(None)):
    """Clean « Activité »: one action, or all of them without an id."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    guarded(lambda: store("activity_delete", p_id=activity_id))
    return {"ok": True}


@app.get("/api/admin/clients")
def admin_clients(pbb_admin: str = Cookie(None)):
    """The owner's client list: first name (PayByPhone, else the Stripe billing name), e-mail, sign-up date, offer,
    renewals. Read from the encrypted accounts, on the server only."""
    if not HOSTED:
        raise HTTPException(403, "Accès réservé.")
    require_admin(pbb_admin)
    rows = guarded(lambda: store("admin_accounts")) or []
    clients = []
    for row in rows:
        try:
            account = json.loads(_fernet("account").decrypt(row["data"].encode()))
        except Exception:
            account = {}
        name = account.get("first_name")
        if not name and account.get("stripe_customer") and os.environ.get("STRIPE_SECRET_KEY"):
            try:
                name = stripe("GET", "customers/" + account["stripe_customer"]).get("name")
            except Exception:
                name = None
        plan = account.get("plan") or "monthly"
        clients.append({"owner": row.get("owner"), "name": name, "email": account.get("email"),
                        "created": row.get("created_at"), "plan": account.get("plan"),
                        "subscribed": bool(account.get("stripe_subscription")),
                        "price": plan_total(account_monthlies(account), plan) if account else None,
                        "renewals": row.get("renewals_active", 0), "origin": account.get("origin")})

    # Each client's vehicles and running tickets, read from PayByPhone with the stored login (in parallel), kept
    # 5 minutes: reopening the admin does not log in to every client's PayByPhone account again.
    def parking(owner):
        kept = _admin_parking.get(owner)
        if kept and time.time() - kept[0] < 300:
            return kept[1]
        found = read_parking(owner)
        if found is not None:
            _admin_parking[owner] = (time.time(), found)
        return found

    def read_parking(owner):
        try:
            bot = bot_from_refresh(None, owner)
            try:
                cards = card_dates(bot.get_payment_accounts())
            except Exception as e:
                log.info("admin: cards unreadable for a client: %s", type(e).__name__)
                cards = None
            vehicles = [v["licensePlate"] for v in bot.get_vehicles() if not v.get("archived")]
            running = {}
            for x in bot.get_parking_sessions():
                plate, end = (x.get("vehicle") or {}).get("licensePlate"), x.get("expireTime")
                if plate and end and (plate not in running or end > running[plate]):
                    running[plate] = end
            return {"vehicles": [{"plate": p, "expire": running[p].isoformat() if p in running else None} for p in vehicles],
                    "cards": cards}
        except Exception as e:
            log.info("admin: PayByPhone unreadable for a client: %s", type(e).__name__)
            return None

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        for client, found in zip(clients, pool.map(parking, [c.pop("owner") for c in clients])):
            client["vehicles"], client["cards"] = (found["vehicles"], found["cards"]) if found else (None, None)
    return clients


@app.get("/api/resident-zone")
def resident_zone(pbb_session: str = Cookie(None)):
    """Guess the home zone from PayByPhone's history: a zone where the car is offered the resident rate.

    Long tickets (about a day or more) are tried first, then the others; each candidate is checked with
    PayByPhone, since only the home zone offers the resident rate. At most a few zones are checked.
    """
    s = current(pbb_session)
    return guarded(lambda: find_home_zone(s))


PARIS_ZONES = ["750%02d" % n for n in range(1, 21)]  # resident zones are numbered like the arrondissement's postcode


def scan_vehicle_zone(s, vehicle):
    """The arrondissement where PayByPhone offers this vehicle the resident rate, among the 20 (the rate only exists
    in the arrondissement of its resident card), or None."""
    from concurrent.futures import ThreadPoolExecutor

    bot = s.bot

    def resident_in(zone):
        try:
            rates = bot.get_rate_options(zone, vehicle["licensePlate"]) or []
        except Exception as e:
            if "getRateOptions" in str(e):  # PayByPhone has no rate there for this vehicle: a real « no »
                return False
            return None  # busy (429) or unreachable: unknown, not « no »
        return any(RESIDENT_RATE.search("%s %s" % (r.get("name"), r.get("type"))) and not r.get("parkingNotAllowedReason")
                   for r in rates)

    # Four at a time: ten in parallel made PayByPhone answer 429 (too many requests).
    with ThreadPoolExecutor(max_workers=4) as pool:
        hits = list(pool.map(resident_in, PARIS_ZONES))
    if any(hits):
        return PARIS_ZONES[hits.index(True)]
    if None in hits:
        raise ScanIncomplete("%d arrondissements not answered" % hits.count(None))
    return None


class ScanIncomplete(Exception):
    """PayByPhone did not answer for every arrondissement: whether the vehicle is resident is not known yet."""


def scan_resident_zone(s):
    """Where PayByPhone offers one of the account's vehicles the resident rate, among the 20 Paris arrondissements
    (the rate only exists in the arrondissement of the resident card). None: no resident vehicle at all."""
    from concurrent.futures import ThreadPoolExecutor

    vehicles = [v for v in s.call("get_vehicles") if not v.get("archived")]  # also renews the login if needed
    vehicles.sort(key=lambda v: bool(TWO_WHEELS.search(str(v.get("type") or ""))))  # cars first
    bot = s.bot

    def resident_in(zone, vehicle):
        try:
            rates = bot.get_rate_options(zone, vehicle["licensePlate"]) or []
        except Exception:
            return False
        return any(RESIDENT_RATE.search("%s %s" % (r.get("name"), r.get("type"))) and not r.get("parkingNotAllowedReason")
                   for r in rates)

    for vehicle in vehicles:
        with ThreadPoolExecutor(max_workers=4) as pool:  # 10 at once made PayByPhone answer 429
            hits = list(pool.map(lambda z: resident_in(z, vehicle), PARIS_ZONES))
        if any(hits):
            return PARIS_ZONES[hits.index(True)]
    return None


def resident_home_zone(s):
    """The home zone if one of the account's vehicles has the resident rate there, else None: from the account or
    the history first, else by asking PayByPhone arrondissement by arrondissement."""
    found = vehicle_zones(s, keep=False)  # at sign-up nothing is kept before the code
    return found[0][1] if found else None


def find_home_zone(s, scan=True):
    """The home zone: set by the user, else guessed from PayByPhone's history (see resident_zone), else found by
    looking for the resident rate in each Paris arrondissement (kept on the account)."""
    def find():
        account = load_account(s)
        manual = account.get("zone")
        if manual:  # added by the user in "Mon compte", or found once
            return {"zone": manual, "manual": not account.get("zone_found")}
        history = s.call("get_past_sessions", limit=30) + s.call("get_parking_sessions")

        def long_ticket(x):
            start, end = parse_dt(x.get("startTime")), parse_dt(x.get("expireTime"))
            return bool(start and end and end - start >= timedelta(hours=20))

        candidates, seen = [], set()
        for x in sorted(history, key=lambda x: not long_ticket(x)):  # stable: keeps recency within each group
            zone, plate = str(x.get("locationId") or ""), (x.get("vehicle") or {}).get("licensePlate")
            if zone and plate and zone not in seen:
                seen.add(zone)
                candidates.append((zone, plate))
        for zone, plate in candidates[:5]:
            try:
                rates = s.call("get_rate_options", zone, plate) or []
            except Exception as e:
                log.info("resident zone: zone check failed: %s", str(e)[:120])
                continue
            if any(RESIDENT_RATE.search("%s %s" % (r.get("name"), r.get("type"))) and not r.get("parkingNotAllowedReason")
                   for r in rates):
                return {"zone": zone}
        zone = scan_resident_zone(s) if scan else None
        if zone:
            try:
                save_account(s, {"zone": zone, "zone_found": True})
            except Exception as e:
                log.warning("found zone not kept: %s", type(e).__name__)
        return {"zone": zone}

    return find()


def update_own_renewal(s, ap_id, patch):
    """Hosted: change one of the user's stored renewals; returns it in the interface's shape."""
    try:
        return stored_to_autopilot(store("renewal_update_owned", p_owner=owner_id(s.username), p_id=ap_id,
                                         p_patch=patch))
    except requests.HTTPError as e:
        answer = getattr(e.response, "text", "") or ""
        if "P0002" in answer or getattr(e.response, "status_code", 0) == 404:  # not this user's, or gone
            raise HTTPException(404, "Renouvellement introuvable.")
        log.warning("renewal update failed: %s", answer[:200])
        raise HTTPException(502, "Service momentanément indisponible. Réessayez dans un instant.")


@app.post("/api/autopilots/{ap_id}/pause")
def pause_autopilot(ap_id: str, body: Pause, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    start, end = pause_bounds(body.start, body.end)
    info = {"from_day": date.fromisoformat(body.start).strftime("%d/%m/%Y"),
            "until_day": date.fromisoformat(body.end).strftime("%d/%m/%Y") if body.end else None}
    if HOSTED and not s.demo:
        ap = update_own_renewal(s, ap_id, {"paused_from": start, "paused_until": end})
        notify(ap, "paused", **info)
        log.info("renewal %s paused", ap_id)
        record_activity("Pause programmée", s, ["Du %s%s." % (info["from_day"], " au " + info["until_day"] if info["until_day"] else ", sans date de fin")])
        return ap
    ap = s.autopilots.get(ap_id)
    if not ap:
        raise HTTPException(404, "Renouvellement introuvable.")
    ap.update(pausedFrom=start, pausedUntil=end)
    return ap


@app.delete("/api/autopilots/{ap_id}/pause")
def resume_autopilot(ap_id: str, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    if HOSTED and not s.demo:
        # Ends a pause, or relaunches a suspended renewal; checked right away: a ticket may be needed now (a ticket
        # already running is never paid twice: the renewal waits for its end).
        owner = owner_id(s.username)
        before = next((r for r in store("renewal_list", p_owner=owner) if r["id"] == ap_id), None)
        refresh = getattr(s.bot, "refresh_token", None)
        relaunch = bool(before and (not before.get("enabled") or before.get("last_error")) and refresh)  # suspended or failed
        # Blocked account: said before anything is written (the renewal keeps its state and its reason).
        if relaunch and billing_state(guarded(lambda: load_account(s)), owner) in BLOCKED_STATES:
            raise HTTPException(402, "Compte bloqué : débloquez-le (bandeau en haut de page) pour relancer le "
                                     "renouvellement.")
        # A relaunch is tried below, in this request: keep the scheduler off it meanwhile (never two payments at once).
        check = datetime.now(timezone.utc) + (timedelta(minutes=10) if relaunch else timedelta())
        result = update_own_renewal(s, ap_id, {"paused_from": None, "paused_until": None, "enabled": True,
                                               "last_error": None, "next_check": utc_iso(check)})
        if relaunch:
            # Relaunched: try now, in this request, so the user sees the outcome (ticket or reason) within a minute
            # instead of « Paiement en cours… » until the next scheduler run.
            row = next((r for r in store("renewal_list", p_owner=owner) if r["id"] == ap_id), None)
            if row:
                process_renewal({**row, "owner": owner}, refresh_token=refresh,
                                refused=bool(before.get("last_error")))
                row = next((r for r in store("renewal_list", p_owner=owner) if r["id"] == ap_id), row)
                result = with_next_ticket(stored_to_autopilot(row))
        return result
    ap = s.autopilots.get(ap_id)
    if not ap:
        raise HTTPException(404, "Renouvellement introuvable.")
    ap.update(pausedFrom=None, pausedUntil=None, enabled=True, lastError=None)
    s.unconfirmed.pop((ap["plate"], ap["location"]), None)
    if HOSTED:
        run_autopilot(s, ap)
    return ap


@app.put("/api/autopilots/{ap_id}/email")
def change_autopilot_email(ap_id: str, body: EmailChange, pbb_session: str = Cookie(None)):
    check_email(body.email)
    s = current(pbb_session)
    if HOSTED and not s.demo:
        current_row = next((r for r in store("renewal_list", p_owner=owner_id(s.username)) if r["id"] == ap_id), None)
        if not current_row:
            raise HTTPException(404, "Renouvellement introuvable.")
        details = {**with_details(current_row), "email": body.email.strip()}
        return update_own_renewal(s, ap_id, {"data": encrypt_details(details)})
    ap = s.autopilots.get(ap_id)
    if not ap:
        raise HTTPException(404, "Renouvellement introuvable.")
    ap["email"] = body.email.strip()
    return ap


@app.delete("/api/me/data")
def delete_my_data(response: Response, pbb_session: str = Cookie(None)):
    """Erase everything kept for this account (stored renewals), then log out."""
    s = current(pbb_session)
    email = None
    try:  # where to confirm the deletion: the account e-mail, else one given for a renewal
        email = load_account(s).get("email")
        if not email and HOSTED and not s.demo:
            email = next((with_details(r).get("email") for r in store("renewal_list", p_owner=owner_id(s.username))
                          if with_details(r).get("email")), None)
    except Exception as e:
        log.warning("account e-mail unreadable before deletion: %s", e)
    if HOSTED and not s.demo:
        try:  # a free month already started outlives the account (fingerprints only): no second one at a new sign-up
            account = load_account(s) or {}
            mark_trial(s, parse_dt(account.get("trial_start")), account.get("email"))
        except Exception as e:
            log.warning("free month not recorded before deletion: %s", e)
        sub_id = (load_account(s) or {}).get("stripe_subscription")
        if sub_id and os.environ.get("STRIPE_SECRET_KEY"):
            try:  # nothing more is charged once the account is gone
                stripe("DELETE", "subscriptions/" + sub_id)
                log.info("subscription cancelled with the account")
            except HTTPException as e:
                log.warning("subscription not cancelled with the account: %s", e.detail)
        guarded(lambda: store("renewal_delete_owner", p_owner=owner_id(s.username)))
        guarded(lambda: store("push_delete_owner", p_owner=owner_id(s.username)))
        guarded(lambda: store("account_delete", p_owner=owner_id(s.username)))
    if email and not s.demo:
        send_email(email, "Compte PayByBot supprimé", "Votre compte est supprimé",
                   ["Votre compte PayByBot a été supprimé à votre demande. Les renouvellements automatiques sont "
                    "arrêtés et tout ce que PayByBot gardait pour vous est effacé, sauf une empreinte anonyme qui permet de "
                    "n'offrir le mois gratuit qu'une fois.",
                    "Les tickets déjà en cours restent valables jusqu'à leur fin. Votre compte PayByPhone n'est pas "
                    "modifié.",
                    "Vous n'avez rien demandé ? Écrivez-nous à %s ou répondez simplement à cet e-mail." % MAIL_REPLY_TO],
                   footer="Vous recevez cet e-mail parce que votre compte PayByBot vient d'être supprimé.")
    record_activity("Compte supprimé", lines=["Client : %s." % (email or s.username[:4] + "***")])
    s.account = {}
    s.autopilots.clear()
    s.logged_out = True  # the middleware must not write the cookie back
    SESSIONS.pop(pbb_session or "", None)
    response.delete_cookie(COOKIE, path="/")
    log.info("data deleted for %s***", s.username[:4])
    return {"ok": True}


@app.put("/api/autopilots/{ap_id}")
def edit_autopilot(ap_id: str, body: Autopilot, pbb_session: str = Cookie(None)):
    """A programmed ticket (non-resident) changed in place: zone, rate, length, days, time, card. Its vehicle stays:
    another car is another ticket. The tickets already taken are kept, so nothing is paid twice the same day."""
    s = current(pbb_session)
    days, start = checked_days(body)
    if not days:
        raise HTTPException(400, "Seuls les tickets programmés se modifient.")
    same_car = "Le véhicule ne se change pas : arrêtez ce ticket et programmez-en un pour l'autre véhicule."
    if HOSTED and not s.demo:
        row = next((r for r in guarded(lambda: store("renewal_list", p_owner=owner_id(s.username))) if r["id"] == ap_id),
                   None)
        if not row:
            raise HTTPException(404, "Ticket introuvable.")
        old = with_details(row)
        if plate_key(old["plate"]) != plate_key(body.plate):
            raise HTTPException(400, same_car)
        check_offer(s)
        check_card(s, body.paymentAccountId)
        details = {**old, "location": body.location, "rate": body.rate, "duration": fmt_qty(body.duration),
                   "unit": body.unit, "payment_account_id": body.paymentAccountId, "days": days, "start": start,
                   "tz": body.tz or old.get("tz") or "", "date_from": body.dateFrom or "", "date_to": body.dateTo or "",
                   "cmis_attested_at": (old.get("cmis_attested_at") or utc_iso(datetime.now(timezone.utc)))
                   if body.cmis else ""}
        ap = update_own_renewal(s, ap_id, {"data": encrypt_details(details), "last_error": None,
                                           "next_check": utc_iso(datetime.now(timezone.utc))})
        log.info("renewal %s edited", ap_id)
        return with_next_ticket(ap)
    ap = s.autopilots.get(ap_id)
    if not ap:
        raise HTTPException(404, "Ticket introuvable.")
    if plate_key(ap["plate"]) != plate_key(body.plate):
        raise HTTPException(400, same_car)
    check_card(s, body.paymentAccountId)
    ap.update(location=body.location, rate=body.rate, duration=fmt_qty(body.duration), unit=body.unit,
              paymentAccountId=body.paymentAccountId, days=days, start=start, dateFrom=body.dateFrom,
              dateTo=body.dateTo, cmis=body.cmis, lastError=None)
    return ap


@app.delete("/api/autopilots/{ap_id}")
def delete_autopilot(ap_id: str, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    if HOSTED and not s.demo:
        guarded(lambda: store("renewal_delete", p_owner=owner_id(s.username), p_id=ap_id))
        follow_renewals(s)
        record_activity("Renouvellement ou ticket arrêté", s)
    else:
        s.autopilots.pop(ap_id, None)
    return {"ok": True}


# --------------------------------------------------------------------------
# Front-end
# --------------------------------------------------------------------------

# A page loaded during a deployment switch (or an old copy kept by the browser) can ask for the previous build's
# files, which no longer exist: instead of a blank page, a missing script reloads the page to get the current build.
# At most once every 30 seconds, so a later deployment in the same tab is caught too, without a reload loop.
RELOAD_ONCE_JS = ("try{var t=+sessionStorage.getItem('pbb-reloaded')||0;if(Date.now()-t>30000){"
                  "sessionStorage.setItem('pbb-reloaded',String(Date.now()));location.reload()}}catch(e){}")


# --------------------------------------------------------------------------
# « Valider mon paiement »: the bank's confirmation, opened by the card holder
# --------------------------------------------------------------------------

VALIDATE_TTL = 3 * 86400
VALIDATE_PER_DAY = 6  # a link that pays: not without limit


def validate_token(owner, renewal_id):
    return _fernet("validate").encrypt(json.dumps({"o": owner, "i": renewal_id}).encode()).decode()


def validate_link(owner, renewal_id):
    return APP_URL.rstrip("/") + "/#/valider?t=" + validate_token(owner, renewal_id)


def challenge_sig(html):
    return hmac.new(_subkey(_secrets()[0], "challenge"), html.encode(), hashlib.sha256).hexdigest()


class ValidateBody(BaseModel):
    t: str = Field(max_length=2000)


def challenge_answer(page):
    if page.get("url"):
        return {"status": "challenge", "url": page["url"]}
    if page.get("html"):
        return {"status": "challenge", "html": page["html"], "sig": challenge_sig(page["html"])}
    return None


@app.post("/api/validate")
def validate_payment(body: ValidateBody):
    """The button of the signed link (never a GET: mail scanners open links). The bank's page of the payment still
    waiting if there is one, else a new payment now that the card holder is there. Nothing is ever paid twice: the
    running ticket is looked at first."""
    try:
        token = json.loads(_fernet("validate").decrypt(body.t.encode(), ttl=VALIDATE_TTL))
    except Exception:
        raise HTTPException(400, "Ce lien n'est plus valable. Ouvrez PayByBot pour voir votre renouvellement.")
    owner = token["o"]
    raw = next((r for r in store("renewal_list", p_owner=owner) or [] if r.get("id") == token["i"]), None)
    row = with_details(raw) if raw else None
    if not row or row.get("last_error") != BANK_WAIT:
        return {"status": "done"}
    key = "validate:%s:%s" % (row["id"], paris_day())
    if (store("usage_add", p_keys=[key]) or {}).get(key, 0) > VALIDATE_PER_DAY:
        raise HTTPException(429, "Trop d'essais aujourd'hui. Vérifiez votre carte dans l'application PayByPhone.")
    if guarded_state(owner) in BLOCKED_STATES:
        raise HTTPException(402, BLOCKED)
    refresh = decrypt_credential(store("renewal_get_credential", p_owner=owner))
    bot = bot_from_refresh(refresh, owner)
    session = UserSession.for_bot(bot)
    now = datetime.now(timezone.utc)
    if bank_validated(row, running_for(session, row["plate"])):
        process_renewal(raw, refresh_token=bot.refresh_token or refresh)  # records it as paid and tells the client
        return {"status": "paid"}
    page = session.call("get_job_challenge", row["bank_job"]) if row.get("bank_job") else {}
    try:
        page = past_hidden_step(session, row["bank_job"], page)
    except Exception as e:
        log.info("bank hidden step: %s", type(e).__name__)
    if page.get("pending") and not page.get("hidden") and challenge_answer(page):
        store("renewal_update", p_id=row["id"], p_patch={"next_check": utc_iso(now + timedelta(minutes=15))})
        return challenge_answer(page)
    outcome = process_renewal(raw, refresh_token=bot.refresh_token or refresh, refused=True, validating=True)
    if outcome == "paid":
        return {"status": "paid"}
    if outcome == "bank_wait":
        fresh = next((r for r in store("renewal_list", p_owner=owner) or [] if r.get("id") == row["id"]), raw)
        job = with_details(fresh).get("bank_job")
        answer = challenge_answer(session.call("get_job_challenge", job) if job else {})
        if answer:
            return answer
    raise HTTPException(502, "Le paiement n'a pas pu être relancé. Vérifiez votre carte dans l'application PayByPhone.")


def challenge_page_response(html, sig):
    """The bank's page as PayByPhone gives it: only what this server signed, isolated from the site (no access to its
    cookies or its API), free to reach the bank."""
    if not hmac.compare_digest(sig, challenge_sig(html)):
        raise HTTPException(400, "Page refusée.")
    return HTMLResponse(base64.b64decode(html), headers={
        "Content-Security-Policy": "sandbox allow-forms allow-scripts allow-top-navigation allow-popups"})


@app.post("/api/validate/page")
async def validate_page(request: Request):
    from urllib.parse import parse_qs

    form = parse_qs((await request.body()).decode())
    return challenge_page_response((form.get("html") or [""])[0], (form.get("sig") or [""])[0])


# --------------------------------------------------------------------------
# Alerts on the phone (Web Push): free, the browser's own service
# --------------------------------------------------------------------------

PUSH_HOSTS = ("fcm.googleapis.com", "web.push.apple.com", ".push.services.mozilla.com", ".notify.windows.com")


def vapid_private():
    """Derived from the app's secret: nothing more to store, and the same key on every server."""
    from cryptography.hazmat.primitives.asymmetric import ec

    order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
    seed = hashlib.sha256(_subkey(_secrets()[0], "vapid")).digest()
    return ec.derive_private_key(int.from_bytes(seed, "big") % (order - 1) + 1, ec.SECP256R1())


def vapid_public_key():
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    raw = vapid_private().public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def webpush_send(subscription, payload):
    from py_vapid import Vapid02
    from pywebpush import webpush

    webpush(subscription, json.dumps(payload), vapid_private_key=Vapid02(private_key=vapid_private()),
            vapid_claims={"sub": "mailto:contact@paybybot.fr"}, timeout=10, ttl=86400)


def send_push(owner, title, body, url):
    """To each phone of this account that accepted alerts. Never raises: the e-mail goes out anyway."""
    try:
        rows = store("push_list", p_owner=owner) or []
    except Exception as e:
        log.warning("push not read: %s", type(e).__name__)
        return
    for data in rows:
        try:
            subscription = json.loads(_fernet("push").decrypt(data.encode()))
            webpush_send(subscription, {"title": title, "body": body, "url": url})
        except Exception as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            log.warning("push not sent: %s %s", type(e).__name__, status)
            if status in (404, 410):  # this phone took the alerts back
                try:
                    store("push_delete", p_key=hashlib.sha256(subscription["endpoint"].encode()).hexdigest())
                except Exception:
                    pass


class PushSub(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: dict[str, Annotated[str, Field(max_length=300)]]

    @field_validator("endpoint")
    @classmethod
    def only_push_services(cls, value):
        """The server calls this address: only the browsers' real services, never anything else."""
        from urllib.parse import urlparse

        url = urlparse(value)
        host = url.hostname or ""
        if url.scheme != "https" or not any(host == h or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS):
            raise ValueError("Adresse refusée.")
        return value


@app.get("/api/push/key")
def push_key():
    return {"key": vapid_public_key()}


@app.post("/api/push/subscribe")
def push_subscribe(body: PushSub, pbb_session: str = Cookie(None)):
    s = current(pbb_session)
    if HOSTED and not s.demo:
        data = _fernet("push").encrypt(json.dumps(body.model_dump()).encode()).decode()
        guarded(lambda: store("push_save", p_owner=owner_id(s.username),
                              p_key=hashlib.sha256(body.endpoint.encode()).hexdigest(), p_data=data))
    return {"ok": True}


class Assets(StaticFiles):
    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
            if response.status_code == 200:
                # Built files carry their content's hash in their name: kept a year by the browser and Vercel's CDN,
                # never downloaded twice (a new version has new names; the page itself is never cached).
                response.headers["Cache-Control"] = "public, max-age=31536000, s-maxage=31536000, immutable"
            return response
        except HTTPException as e:
            if e.status_code != 404:
                raise
        except Exception:
            pass
        from fastapi.responses import Response as RawResponse

        if path.endswith(".js"):
            return RawResponse(RELOAD_ONCE_JS, media_type="text/javascript", headers={"Cache-Control": "no-store"})
        if path.endswith(".css"):
            return RawResponse("", media_type="text/css", headers={"Cache-Control": "no-store"})
        return RawResponse(status_code=404)


@app.get("/favicon.ico", include_in_schema=False)
def favicon_ico():
    """Google and some browsers ask for /favicon.ico whatever the page says: the current logo (48 px PNG)."""
    return RedirectResponse("/favicon-48.png", 301)


if (STATIC_DIR / "assets").exists():
    app.mount("/assets", Assets(directory=STATIC_DIR / "assets"), name="assets")


class ContactMessage(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
    message: str = Field(min_length=2, max_length=3000)
    website: str = Field(default="", max_length=200)  # left empty by people, filled by bots


@app.post("/api/contact")
def contact(body: ContactMessage, request: Request, pbb_session: str = Cookie(None)):
    """The « Contact » window: the message goes to the contact address, a reply goes straight to the visitor."""
    if body.website:  # a bot filled the hidden field: say it went, send nothing
        return {"ok": True}
    check_email(body.email)
    if HOSTED:
        ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        key = hmac.new(_subkey(_secrets()[0], "rate"), ip.encode(), hashlib.sha256).hexdigest()
        if not guarded(lambda: store("rate_hit", p_key="contact:" + key, p_window_seconds=3600, p_max=5)):
            raise HTTPException(429, "Trop de messages envoyés. Réessayez dans une heure, ou écrivez à %s." % MAIL_REPLY_TO)
    account = ""
    try:  # signed in: say which PayByPhone account writes, to answer faster
        account = current(pbb_session).username
    except Exception:
        pass
    text = body.message.strip()
    lines = ["De : %s" % body.email.strip()] + (["Compte PayByPhone : %s" % account] if account else []) \
        + [x.strip() for x in re.split(r"\n\s*\n", text) if x.strip()]
    if not send_email(MAIL_REPLY_TO, "Message du site · %s" % body.email.strip(), "Nouveau message", lines,
                      footer="Envoyé depuis la fenêtre « Contact » de paybybot.fr. Répondez à cet e-mail pour "
                             "écrire au visiteur.", reply_to=body.email.strip()):
        raise HTTPException(503, "Le message n'a pas pu partir. Écrivez-nous à %s." % MAIL_REPLY_TO)
    log.info("contact message sent (%d characters)", len(text))
    return {"ok": True}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    target = (STATIC_DIR / path).resolve()
    if path and target.is_file() and STATIC_DIR.resolve() in target.parents:
        # Fonts and images keep their name across versions: kept a month (fonts) or a day, not asked again each visit.
        ttl = 2592000 if path.startswith("fonts/") else 86400
        return FileResponse(target, headers={"Cache-Control": "public, max-age=%d" % ttl})
    index = STATIC_DIR / "index.html"
    if not index.exists():
        raise HTTPException(404, "Interface non compilée : lancez `npm run build` dans web/.")
    # Never keep the page (no cache, no back/forward copy): a stale copy points to a previous deployment's assets.
    # Any other path gets the page with a 404 status: the app shows "page not found", search engines skip it.
    # A referral link (/r/<code>) is the page itself: 200, so link previews (WhatsApp…) read its title and image.
    ok = path in ("", "index.html") or re.fullmatch(r"r/[0-9A-Za-z_-]{1,40}/?", path)
    return FileResponse(index, status_code=200 if ok else 404, headers={"Cache-Control": "no-store"})


def serve(host="127.0.0.1", port=8765, open_browser=True):
    import uvicorn
    import webbrowser

    if open_browser:
        threading.Timer(1.5, lambda: webbrowser.open("http://%s:%s" % (host, port))).start()
    uvicorn.run(app, host=host, port=port, log_level="warning")

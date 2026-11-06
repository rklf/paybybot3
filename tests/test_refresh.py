import os
import unittest
from unittest.mock import MagicMock, patch

import requests
from fastapi import HTTPException

from paybybot3 import web


def refused(status=400, code="invalid_grant"):
    response = MagicMock(status_code=status)
    response.json.return_value = {"error": code}
    return requests.HTTPError(response=response)


def bot(refresh):
    b = MagicMock(refresh_token=refresh)
    b.get_vehicles.return_value = ["AB-123-CD"]
    return b


class SharedRefreshToken(unittest.TestCase):
    """The cookie and the renewals hold PayByPhone refresh tokens; using one may replace it."""

    def setUp(self):
        self.patches = [patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True)]
        for p in self.patches:
            p.start()
        self.session = web.UserSession.from_state({"u": "+33612345678", "d": False, "t": "Bearer old", "r": "cookie"})
        expired = MagicMock(refresh_token="cookie")
        expired.get_vehicles.side_effect = refused(401)
        self.session.bot = expired

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_stale_cookie_token_falls_back_on_the_stored_one(self):
        logins = {"cookie": refused(), "stored": bot("newest")}

        def login(token):
            if isinstance(logins[token], Exception):
                raise logins[token]
            return logins[token]

        with patch.object(web.Bot, "from_refresh_token", side_effect=login), \
                patch.object(web, "stored_refresh", return_value="stored"), \
                patch.object(web, "share_refresh") as share:
            self.assertEqual(self.session.call("get_vehicles"), ["AB-123-CD"])
        self.assertEqual(self.session.bot.refresh_token, "newest")  # written back into the cookie
        share.assert_called_once_with(web.owner_id("+33612345678"), "newest")

    def test_replaced_token_is_shared_with_the_renewals(self):
        used = []

        def login(token):
            used.append(token)
            return bot("rotated")
        with patch.object(web.Bot, "from_refresh_token", side_effect=login), \
                patch.object(web, "stored_refresh", return_value="stored"), patch.object(web, "share_refresh") as share:
            self.session.call("get_vehicles")
        # The newest stored token first: the cookie's copy, maybe replaced already, is never sent before it.
        self.assertEqual(used, ["stored"])
        share.assert_called_once_with(web.owner_id("+33612345678"), "rotated")

    def test_both_refused_asks_to_log_in_again(self):
        with patch.object(web.Bot, "from_refresh_token", side_effect=refused()), \
                patch.object(web, "stored_refresh", return_value="stored"), patch.object(web, "share_refresh"):
            with self.assertRaises(HTTPException) as e:
                self.session.call("get_vehicles")
        self.assertEqual(e.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()

from datetime import datetime
import re

import requests


class Bot:
    base_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://m2.paybyphone.fr/",
        "Origin": "https://m2.paybyphone.fr",
        "DNT": "1",
        "Connection": "keep-alive",
    }

    def __init__(self, username, password):
        url = "https://m2.paybyphone.fr/static/js/main.0aec44c0.chunk.js"
        try:
            resp = requests.get(url)
            resp.raise_for_status()
            pattern = r'paymentService:{[^}]*apiKey:\"(.*?)\"'
            result = re.search(pattern, resp.text, flags=re.MULTILINE)
            self.apiKey = result.group(1) if result else None
        except (requests.exceptions.HTTPError, KeyError):
            self.apiKey = None

        r = requests.post(
            "https://auth.paybyphoneapis.com/token",
            headers={
                **self.base_headers,
                "Accept": "application/json, text/plain, */*",
                "X-Pbp-ClientType": "WebApp",
            },
            data={
                "grant_type": "password",
                "username": username,
                "password": password,
                "client_id": "paybyphone_webapp",
            },
        )
        j = r.json()
        self.authorization = j["token_type"] + " " + j["access_token"]

        r = self._get("https://consumer.paybyphoneapis.com/parking/accounts")
        j = r.json()
        self.parkingAccountId = j[0]["id"]

    def _get_parking_sessions(self):
        ans = self._get(
            "https://consumer.paybyphoneapis.com/parking/accounts/%s/sessions"
            % self.parkingAccountId,
            params={"periodType": "Current"},
        ).json()
        for s in ans:
            s["startTime"] = datetime.strptime(s["startTime"], "%Y-%m-%dT%H:%M:%SZ")
            s["expireTime"] = datetime.strptime(s["expireTime"], "%Y-%m-%dT%H:%M:%SZ")
        return ans

    def get_parking_sessions(self, licensePlate=None, locationId=None):
        def pred(p):
            if licensePlate is not None:
                if p["vehicle"]["licensePlate"] != licensePlate:
                    return False
            if locationId is not None:
                if p["locationId"] != locationId:
                    return False
            return True

        return list(filter(pred, self._get_parking_sessions()))

    def last_expiry(self, licensePlate, locationId):
        return max(
            (
                session["expireTime"]
                for session in self.get_parking_sessions(licensePlate, locationId)
            ),
            default=None,
        )

    def get_payment_accounts(self):
        return self._get("https://payments.paybyphoneapis.com/v1/accounts").json()

    def _get_rate_options(self, location, licensePlate):
        return self._get(
            "https://consumer.paybyphoneapis.com/parking/locations/%s/rateOptions" % location,
            params={
                "parkingAccountId": self.parkingAccountId,
                "licensePlate": licensePlate,
            },
        ).json()

    def _get_rate_options_renew(self, location, parkingSessionId):
        return self._get(
            "https://consumer.paybyphoneapis.com/parking/locations/%s/rateOptions" % location,
            params={
                "parkingAccountId": self.parkingAccountId,
                "parkingSessionId": parkingSessionId,
            },
        ).json()

    def _get_quote(
        self, durationQuantity, durationTimeUnit, licensePlate, locationId, rateOptionId
    ):
        return self._get(
            "https://consumer.paybyphoneapis.com/parking/accounts/%s/quote"
            % self.parkingAccountId,
            params={
                "durationQuantity": durationQuantity,
                "durationTimeUnit": durationTimeUnit,
                "licensePlate": licensePlate,
                "locationId": locationId,
                "rateOptionId": rateOptionId,
            },
        ).json()

    def _get_renew_quote(self, durationQuantity, durationTimeUnit, parkingSessionId):
        return self._get(
            "https://consumer.paybyphoneapis.com/parking/accounts/%s/quote"
            % self.parkingAccountId,
            params={
                "durationQuantity": durationQuantity,
                "durationTimeUnit": durationTimeUnit,
                "parkingSessionId": parkingSessionId,
            },
        )

    def _post_quote(
        self,
        quoteId,
        paymentAccountId,
        licensePlate,
        rateOptionId,
        locationId,
        durationQuantity,
        durationTimeUnit,
        startTime,
    ):
        return self._post(
            "https://consumer.paybyphoneapis.com/parking/accounts/%s/sessions/"
            % self.parkingAccountId,
            json={
                "licensePlate": licensePlate,
                "locationId": locationId,
                "stall": None,
                "rateOptionId": rateOptionId,
                "startTime": startTime,  # found in parkingStartTime of quote
                "quoteId": quoteId,
                "duration": {
                    "timeUnit": durationTimeUnit,
                    "quantity": durationQuantity,
                },
                "paymentMethod": {
                    "paymentMethodType": "PaymentAccount",
                    "payload": {"paymentAccountId": paymentAccountId, "cvv": None},
                },
            },
        )

    def _put_renew_quote(
        self,
        parkingSessionId,
        quoteId,
        paymentAccountId,
        durationQuantity,
        durationTimeUnit,
    ):
        r = self._put(
            "https://consumer.paybyphoneapis.com/parking/accounts/%s/sessions/%s"
            % (self.parkingAccountId, parkingSessionId),
            data={
                "duration": {
                    "timeUnit": durationTimeUnit,
                    "quantity": durationQuantity,
                },
                "quoteId": quoteId,
                "paymentMethod": {
                    "paymentMethodType": "PaymentAccount",
                    "payload": {"paymentAccountId": paymentAccountId, "cvv": None},
                },
            },
        )
        assert r.status_code == requests.codes["accepted"]

    def _get_workflow(self, quoteId):
        return self._get("https://consumer.paybyphoneapis.com/events/workflow/%s" % quoteId)

    def pay(
        self,
        durationQuantity,
        durationTimeUnit,
        licensePlate,
        locationId,
        rateOptionId,
        paymentAccountId,
    ):
        quote = self._get_quote(
            durationQuantity=durationQuantity,
            durationTimeUnit=durationTimeUnit,
            licensePlate=licensePlate,
            locationId=locationId,
            rateOptionId=rateOptionId,
        )
        quoteId = quote["quoteId"]
        startTime = quote["parkingStartTime"]

        post = self._post_quote(
            quoteId=quoteId,
            paymentAccountId=paymentAccountId,
            licensePlate=licensePlate,
            rateOptionId=rateOptionId,
            locationId=locationId,
            durationQuantity=durationQuantity,
            durationTimeUnit=durationTimeUnit,
            startTime=startTime,
        )
        return post.text

    def _request(self, method, url, **kwargs):
        return requests.request(
            method,
            url,
            headers={
                **self.base_headers,
                "Accept": "application/json, text/plain, */*",
                "x-pbp-version": "2",
                "x-api-key": self.apiKey,
                "Authorization": self.authorization,
            },
            **kwargs
        )

    def _get(self, url, **kwargs):
        return self._request("GET", url, **kwargs)

    def _post(self, url, **kwargs):
        return self._request("POST", url, **kwargs)

    def _put(self, url, **kwargs):
        return self._request("PUT", url, **kwargs)

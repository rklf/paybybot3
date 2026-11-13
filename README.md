# PayByBot 3

Originally forked from [paybybot2](https://github.com/louisabraham/paybybot2/), this packages implements a CLI interface to [paybyphone](https://www.paybyphone.fr/), allowing you (for example) to automate parking.

## Installation

    pip install paybybot3

## Graphical interface

Not comfortable with the command line? paybybot3 ships a simple web interface (in French) that runs locally:

    paybybot3 web

It opens your browser on `http://127.0.0.1:8765`. You can log in with your PayByPhone account, pay for parking
through a step-by-step wizard (with the exact price shown before paying), and enable a weekly automatic renewal of the resident rate.
A demo mode lets you try it without an account. Credentials are kept in memory only, never written to disk.

Non-technical users can download the ZIP and double-click `Lancer paybybot.command` (macOS) or
`Lancer paybybot.bat` (Windows): see the [French guide](GUIDE.md).

### Hosted version

The same interface can be deployed on Vercel (`main.py`, `requirements.txt`, `vercel.json`). In hosted mode the
server keeps no state: the PayByPhone access token is stored in an encrypted cookie (set `PAYBYBOT_SECRET`), the
password is never stored. Weekly renewals are stored in Supabase (`supabase/migrations/`) with an encrypted
PayByPhone refresh token, and `/api/cron/renew` is called every 5 minutes by `pg_cron`. Server settings:
`PAYBYBOT_SECRET` (optionally `PAYBYBOT_SECRET_OLD` while rotating it), `PAYBYBOT_SUPABASE_URL`,
`PAYBYBOT_SUPABASE_KEY` (publishable key), `PAYBYBOT_DB_TOKEN`, `PAYBYBOT_CRON_TOKEN_SHA256`, `CRON_SECRET`, and
`RESEND_API_KEY` (send-only) for the optional confirmation e-mails. Renewals can be paused for the holidays.

Security measures: strict Content-Security-Policy and no framing, same-origin check on every state-changing
call, login cookies that expire after 12 hours idle and 24 hours at most, login rate limiting, separate keys per
purpose, renewal details and refresh tokens encrypted before they reach the database, an authenticated scheduler
call, pinned dependencies, and a "delete my data" button. Changing `PAYBYBOT_SECRET` invalidates every login and
every stored renewal at once.

### Developing the interface

The front-end lives in `web/` (Vite, React, Tailwind, shadcn/ui) and is built into `paybybot3/static/`:

    cd web && npm install
    npm run dev      # hot reload on :5173, API proxied to `paybybot3 web` on :8765
    npm run build    # writes paybybot3/static/

## Usage

`CONFIG_NAME` is the name of your configuration, it would be `example_account` in the example configuration below.

`--location` is often the district (eg `75001`). There are some special values that you can find out in the output of `check` as `locationId`.

For `check`, `alert` and `pay`, `--location` also accepts several locations at once, as a comma-separated list or a range: `--location 75001,75005` or `--location 75001-75020`. They are all handled with a single login, and one failing location does not abort the others.

`--rate` is a `ratePolicyId`. List the available rate options for a location with the `rate-options` command, or read it from an ongoing session in the output of `check` (as `ratePolicy.ratePolicyId`).

### alert

```
Usage: paybybot3 alert [OPTIONS] CONFIG_NAME

  1. Check if there is an ongoing subscription

  2. Else send a notification

Options:
  --location TEXT
  --config TEXT
  --help           Show this message and exit.
```

### check

```
Usage: paybybot3 check [OPTIONS] CONFIG_NAME

  Check if there is an ongoing subscription

Options:
  --location TEXT
  --config TEXT
  --help           Show this message and exit.
```

### pay

```
Usage: paybybot3 pay [OPTIONS] CONFIG_NAME

  1. Check if there is an ongoing subscription

  2. Else pay

  3. Check that the payment succeeded

  4. Notify on failure

Options:
  --location TEXT              [required]
  --rate INTEGER               [required]
  --duration TEXT              [required]
  --unit [Days|Hours|Minutes]  Default: Days
  --buffer
  --config TEXT
  --help                       Show this message and exit.
```

### vehicles

```
Usage: paybybot3 vehicles [OPTIONS] CONFIG_NAME

  1. Show the vehicles

Options:
  --config TEXT
  --help           Show this message and exit.
```

### payment-accounts

```
Usage: paybybot3 payment-accounts [OPTIONS] CONFIG_NAME

  Show the payment accounts

Options:
  --config TEXT
  --help         Show this message and exit.
```

### rate-options

```
Usage: paybybot3 rate-options [OPTIONS] CONFIG_NAME

  Show the available rate options for a location (use ratePolicyId as --rate)

Options:
  --location TEXT  [required]
  --config TEXT
  --help           Show this message and exit.
```

## Configuration

paybybot3 allows you to store your configuration in a YAML file `~/.config/paybybot3.yml`.

Here is an example:

```
example_account:
  plate: AB123CD
  paybyphone:
    login: "+330612345678"
    password: password
  apprise: #optional
    services:
      - mail:
          service_url: "mailtos://{user}:{password}@{domain}?name=PayByBot3"
          tag:
            - "broadcast-warning"
            - "broadcast-failure"
      - discord:
          service_url: "discord://{WebhookID}/{WebhookToken}"
          tag:
            - "broadcast-info"
            - "broadcast-success"
            - "broadcast-warning"
            - "broadcast-failure"
      - ...
  paymentAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

Notifications are delivered through the [Apprise](https://github.com/caronc/apprise) library.    
If `apprise` is configured, at least one service must be configured. Service URLs can be found in the Apprise [notification services documentation](https://github.com/caronc/apprise/wiki#notification-services) - refer to their documentation for required and additional parameters. Tags are mandatory and must at least be one of `broadcast-info`, `broadcast-success`, `broadcast-warning` or `broadcast-failure`, they are used to filter the notifications you want to receive.

The `paymentAccountId` can be found in the output of the `payment-accounts` command (under `paymentCards`, or whichever payment method you use).

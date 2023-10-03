# PayByBot 3

Originally forked from [paybybot2](https://github.com/louisabraham/paybybot2/), this packages implements a CLI interface to [paybyphone](https://www.paybyphone.fr/), allowing you (for example) to automate parking.

## Installation

    pip install paybybot3

## Usage

`CONFIG_NAME` is the name of your configuration, it would be `example_account` in the example configuration below.

`--location` is often the district (eg `75001`). There are some special values that you can find out in the output of `check` as `locationId`.

Similarly, you can find `--rate` as `rateOptionId` in the output of `check`.

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
  --location TEXT  [required]
  --rate INTEGER   [required]
  --duration TEXT  [required]
  --config TEXT
  --help           Show this message and exit.
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

The `paymentAccountId` can be found in the output of the `payment-accounts` command.

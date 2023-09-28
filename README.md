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
    host: "http://localhost:8000/notify/KEY"
    tags: 
      - "my_tag"
    notify: true
    notify_on_error: true
  paymentAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

Notifications are delivered through the [Apprise API](https://github.com/caronc/apprise-api) 

The `paymentAccountId` can be found in the output of the `payment-accounts` command.

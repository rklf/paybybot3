import functools
from pprint import pprint
import sys
from time import sleep

import click

from .bot import Bot
from .notifs import notify
from .config import get_config
from . import logging


def catch_exceptions(config):
    def catch_exceptions_decorator(fun):
        @functools.wraps(fun)
        def wrapper(*args, **kwargs):
            try:
                return fun(*args, **kwargs)
            except Exception:
                logging.exception(fun.__name__)
                import traceback

                if config.get("apprise"):
                    notify(
                        services=config.get('apprise').get('services'),
                        title="PayByPhone's bot ran into an error",
                        body=traceback.format_exc(),
                        tag="broadcast-failure",
                    )

        return wrapper

    return catch_exceptions_decorator


def connect(config):
    pbp_login = config["paybyphone"]["login"]
    pbp_pwd = config["paybyphone"]["password"]
    bot = Bot(pbp_login, pbp_pwd)
    logging.info("created bot")
    return bot


@click.group()
def cli():
    pass


@cli.command()
@click.argument("config_name")
@click.option("--config", required=False, type=str)
def payment_accounts(config_name, config):
    """
    Show the payment accounts
    """
    config = get_config(config_name, config)
    bot = connect(config)
    pprint(bot.get_payment_accounts())


@cli.command()
@click.argument("config_name")
@click.option("--location", default=None)
@click.option("--config", required=False, type=str)
def check(config_name, location, config):
    """
    Check if there is an ongoing subscription
    """
    config = get_config(config_name, config)

    def _check(config, location):
        bot = connect(config)
        sessions = bot.get_parking_sessions(
            licensePlate=config["plate"], locationId=location
        )
        logging.info(
            "retrieved parking sessions with filter licensePlate=%s, locationId=%s: %s"
            % (config["plate"], location, sessions)
        )
        if sessions:
            logging.info("Found sessions")
            pprint(sessions)
        else:
            logging.info("No session")

    catch_exceptions(config)(_check)(config, location)


@cli.command()
@click.argument("config_name")
@click.option("--location", default=None)
@click.option("--config", required=False, type=str)
def alert(config_name, location, config):
    """
    1. Check if there is an ongoing subscription

    2. Else send a notification
    """

    config = get_config(config_name, config)

    def _alert(config, location):
        bot = connect(config)
        sessions = bot.get_parking_sessions(
            licensePlate=config["plate"], locationId=location
        )
        logging.info(
            "retrieved parking sessions with filter licensePlate=%s, locationId=%s: %s"
            % (config["plate"], location, sessions)
        )
        if sessions:
            logging.info("Found sessions")
            pprint(sessions)
        else:
            logging.info("No session — sending an apprise notification to info broadcast")
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Alert",
                    body="Currently no parking is active: https://m2.paybyphone.fr/parking",
                    tag="broadcast-info",
                )

    catch_exceptions(config)(_alert)(config, location)


@cli.command()
@click.argument("config_name")
@click.option("--location", required=True, type=str)
@click.option("--rate", required=True, type=int)
@click.option("--duration", required=True, type=str)
@click.option("--config", required=False, type=str)
def pay(config_name, location, rate, duration, config):
    """
    1. Check if there is an ongoing subscription

    2. Else pay

    3. Check that the payment succeeded

    4. Notify on failure
    """
    config = get_config(config_name, config)

    def _pay(config, location, duration):
        bot = connect(config)
        logging.info("launching payment")
        sessions = bot.get_parking_sessions(
            licensePlate=config["plate"], locationId=location
        )
        if sessions:
            logging.info("Already registered")
            pprint(sessions)
            return
        bot.pay(
            durationQuantity=duration,
            durationTimeUnit="Days",
            licensePlate=config["plate"],
            locationId=location,
            rateOptionId=rate,
            paymentAccountId=config["paymentAccountId"],
        )
        sleep(20)  # wait for the payment to be executed
        sessions = bot.get_parking_sessions(
            licensePlate=config["plate"], locationId=location
        )
        if not sessions:
            logging.error("Payment failed")
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Payment",
                    body="Payment failed",
                    tag="broadcast-warning",
                )
        else:
            logging.info("Payment succeeded")
            pprint(sessions)
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Payment",
                    body="Payment succeeded",
                    tag="broadcast-success",
                )

    catch_exceptions(config)(_pay)(config, location, duration)


@cli.command()
@click.argument("config_name")
@click.option("--config", required=False, type=str)
def vehicles(config_name, config):
    """
    Show the vehicles
    """
    config = get_config(config_name, config)

    def _vehicles(config):
        bot = connect(config)
        pprint(bot.get_vehicles())

    catch_exceptions(config)(_vehicles)(config)


if __name__ == "__main__":
    cli()

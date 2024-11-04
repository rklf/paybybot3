import functools
from pprint import pprint
from time import sleep
from datetime import datetime, timezone

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
            logging.info(f"Found sessions in {location}")
            pprint(sessions)
        else:
            logging.info(f"No session in {location}")

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
        licensePlate=config["plate"]
        sessions = bot.get_parking_sessions(
            licensePlate=licensePlate, locationId=location
        )
        logging.info(
            f"retrieved parking sessions with filter licensePlate={licensePlate}, locationId={location}: {sessions}"
        )
        if sessions:
            logging.info(f"Found sessions in {location}")
            pprint(sessions)
        else:
            logging.info(f"No session in {location} — sending an apprise notification to info broadcast")
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Alert",
                    body=f"[{licensePlate}] Currently no parking is active in {location} — please check : https://m2.paybyphone.fr/parking",
                    tag="broadcast-info",
                )

    catch_exceptions(config)(_alert)(config, location)


@cli.command()
@click.argument("config_name")
@click.option("--location", required=True, type=str)
@click.option("--rate", required=True, type=int)
@click.option("--duration", required=True, type=str)
@click.option("--unit", default="Days", type=click.Choice(["Days", "Hours", "Minutes"]), help="Default: Days")
@click.option("--buffer", is_flag=True)
@click.option("--config", required=False, type=str)
def pay(config_name, location, rate, duration, unit, buffer, config):
    """
    1. Check if there is an ongoing subscription

    2. Else pay

    3. Check that the payment succeeded

    4. Notify on failure
    """
    config = get_config(config_name, config)

    def _pay(config, location, duration, unit):
        bot = connect(config)
        logging.info("launching payment")
        licensePlate = config["plate"]
        sessions = bot.get_parking_sessions(
            licensePlate=licensePlate, locationId=location
        )
        if sessions:
            logging.info(f"Already registered in {location} for {duration} {unit} at rate {rate}")
            pprint(sessions)
            if buffer:
                expireTime = min([session["expireTime"] for session in sessions])
                expireTime = expireTime.replace(tzinfo=timezone.utc)
                remainingTime = expireTime - datetime.now(timezone.utc)
                logging.info(f"Waiting for the current session to expire in: {remainingTime}")
                sleep(max(0, remainingTime.total_seconds() + 1))
                _pay(config, location, duration, unit)
            return
        bot.pay(
            durationQuantity=duration,
            durationTimeUnit=unit,
            licensePlate=licensePlate,
            locationId=location,
            rateOptionId=rate,
            paymentAccountId=config["paymentAccountId"],
        )
        sleep(20)  # wait for the payment to be executed
        sessions = bot.get_parking_sessions(
            licensePlate=licensePlate, locationId=location
        )
        if not sessions:
            logging.error(f"[{licensePlate}] Payment failed in {location} for {duration} {unit} at rate {rate}")
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Payment",
                    body=f"[{licensePlate}] Payment failed in {location} for {duration} {unit} at rate {rate}",
                    tag="broadcast-warning",
                )
        else:
            logging.info(f"[{licensePlate}] Payment succeeded in {location} for {duration} {unit} at rate {rate}")
            pprint(sessions)
            if config.get("apprise"):
                notify(
                    services=config.get('apprise').get('services'),
                    title="PayByPhone Parking Payment",
                    body=f"[{licensePlate}] Payment succeeded in {location} for {duration} {unit} at rate {rate}",
                    tag="broadcast-success",
                )

    catch_exceptions(config)(_pay)(config, location, duration, unit)


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

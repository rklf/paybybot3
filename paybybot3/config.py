from pathlib import Path
import logging

import yaml


def get_config(config_name, config=None):
    if config:
        with open(config) as ymlfile:
            config = yaml.safe_load(ymlfile)
    else:
        yml_path = Path("~/.config/paybybot3.yml").expanduser()
        if yml_path.exists():
            with yml_path.open() as ymlfile:
                config = yaml.safe_load(ymlfile)
        else:
            logging.warning("~/.config/paybybot3.yml doesn't exist")
            raise FileNotFoundError("Either pass a config file or create ~/.config/paybybot3.yml")
    return config.get(config_name, {})

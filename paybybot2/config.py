from pathlib import Path
import logging

import yaml


yml_path = Path("~/.config/paybybot2.yml").expanduser()
if yml_path.exists():
    with yml_path.open() as ymlfile:
        config = yaml.safe_load(ymlfile)
else:
    logging.warning("~/.config/paybybot2.yml doesn't exist")
    config = {}


def get_config(config_name):
    return config.get(config_name, {})

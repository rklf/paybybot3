from pathlib import Path
import logging

import yaml


yml_path = Path("~/.paybybot2.yml").expanduser()
if yml_path.exists():
    with yml_path.open() as ymlfile:
        config = yaml.load(ymlfile)
else:
    logging.warning("~/.paybybot2.yml doesn't exist")
    config = {}


def get_config(config_name):
    return config.get(config_name, {})

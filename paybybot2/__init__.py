import logging
from os.path import expanduser


logging.basicConfig(
    format="%(asctime)s %(message)s",
    filename=expanduser("~/paybybot2.log"),
    level=logging.INFO,
)

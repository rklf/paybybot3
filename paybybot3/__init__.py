import logging.config
import os
from os.path import expanduser


LOGGER_CONFIG = {
    'version': 1,
    'formatters': {
        'standard': {
            'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        }
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'standard',
            'stream': 'ext://sys.stdout'
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'formatter': 'standard',
            'filename': expanduser('~/paybybot3.log'),
            'mode': 'a',
            'maxBytes': 100_000,
            'backupCount': 2
        }
    },
    'root': {
        'level': 'INFO',
        'handlers': ['console', 'file']
    }
}

# Hosted deployments (e.g. Vercel) have a read-only file system: log to the console only.
if os.environ.get("PAYBYBOT_HOSTED") == "1":
    del LOGGER_CONFIG['handlers']['file']
    LOGGER_CONFIG['root']['handlers'] = ['console']

logging.config.dictConfig(LOGGER_CONFIG)

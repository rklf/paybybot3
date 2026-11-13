"""Print the PAYBYBOT_ADMIN_PASSWORD_HASH for the admin page, asking the password without showing it.

    venv/bin/python scripts/admin_password.py | vercel env add PAYBYBOT_ADMIN_PASSWORD_HASH production

The password itself is never printed or stored, only its PBKDF2 hash.
"""
import getpass
import hashlib
import secrets
import sys

ITERATIONS = 600_000

with open("/dev/tty", "w") as tty:  # prompts on the terminal even when the output is piped
    first = getpass.getpass("Mot de passe admin : ", stream=tty)
    if len(first) < 12:
        sys.exit("Au moins 12 caractères.")
    if getpass.getpass("Une deuxième fois : ", stream=tty) != first:
        sys.exit("Les deux saisies ne correspondent pas.")
salt = secrets.token_bytes(16)
digest = hashlib.pbkdf2_hmac("sha256", first.encode(), salt, ITERATIONS)
sys.stdout.write("pbkdf2_sha256$%d$%s$%s" % (ITERATIONS, salt.hex(), digest.hex()))

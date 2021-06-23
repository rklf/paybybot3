from smtplib import SMTP
import logging


EMAIL_TEMPLATE = """\
From: {email}
To: {email}
Subject: {subject}

{message}
"""


def notify(email, pwd, subject, message, to=None):
    # TODO: add server as parameter
    if to is None:
        to = [email]
    with SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(email, pwd)
        email_text = EMAIL_TEMPLATE.format(
            email=email, subject=subject, message=message
        ).encode("utf8")
        server.sendmail(email, to, email_text)
        logging.info("sent email to %s with message: %s", email, message)

from smtplib import SMTP_SSL
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
    with SMTP_SSL("smtp.gmail.com", 465) as server:
        server.ehlo()
        server.login(email, pwd)
        email_text = EMAIL_TEMPLATE.format(
            email=email, subject=subject, message=message
        ).encode("utf8")
        server.sendmail(email, to, email_text)
        logging.info("sent email to %s with message: %s", email, message)

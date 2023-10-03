import logging
from apprise import Apprise, NotifyType

TAG_MAPPING_NOTIFY_TYPE = {
    "broadcast-info": NotifyType.INFO,
    "broadcast-success": NotifyType.SUCCESS,
    "broadcast-warning": NotifyType.WARNING,
    "broadcast-failure": NotifyType.FAILURE,
}

def notify(services, title, body, tag=None):
    try:
        apobj = _create_apprise_object(services)
        _send_notification(apobj, title, body, tag)
        logging.info("Notification sent successfully for title: %s", title)
    except Exception as e:
        logging.error("Error sending notification: %s", str(e))

def _create_apprise_object(services):
    apobj = Apprise()
    for service in services:
        for service_dict in service.values():
            apobj.add(service_dict.get("service_url"), tag=service_dict.get("tag"))
    return apobj

def _send_notification(apobj, title, body, tag):
    notify_type = TAG_MAPPING_NOTIFY_TYPE.get(tag)
    apobj.notify(title=title, body=body, tag=tag, notify_type=notify_type)

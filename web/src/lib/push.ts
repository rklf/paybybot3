import { api } from '@/lib/api'

/** Alerts on this phone (Web Push). On an iPhone, only from PayByBot added to the home screen. */
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

export const pushAvailable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** An iPhone in Safari: alerts first need PayByBot on the home screen. */
export const needsHomeScreen = () => isIphone() && !standalone()

function keyBytes(key: string) {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Asks the phone's permission and hands its address to the server. False when refused. */
export async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') return false
  const registration = await navigator.serviceWorker.register('/sw.js')
  const ready = await navigator.serviceWorker.ready
  const { key } = await api.pushKey()
  const subscription = await (ready ?? registration).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await api.pushSubscribe(subscription.toJSON())
  return true
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/NotFound'
import { reactErrorHandler, startMonitoringLater } from '@/lib/monitor'

startMonitoringLater() // Sentry after the page is shown, not before

// The current build loaded: allow the one-time reload again for a future deployment switch.
try {
  sessionStorage.removeItem('pbb-reloaded')
} catch {
  /* storage blocked: nothing to reset */
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(), // errors shown by ErrorBoundary are reported too
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

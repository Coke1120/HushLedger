'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  APP_UPDATE_MODE_STORAGE_KEY,
  clearDevelopmentServiceWorkerState,
  isAppServiceWorkerEnabled,
  normalizeAppUpdateMode,
  resolveControllerChange,
  type AppUpdateMode,
} from '../lib/appUpdate'
import {
  AppUpdateContext,
  type AppUpdateContextValue,
  type AppUpdateStatus,
} from './appUpdateContext'

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppUpdateMode>('manual')
  const [status, setStatus] = useState<AppUpdateStatus>('idle')
  const modeRef = useRef<AppUpdateMode>('manual')
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const waitingWorkerRef = useRef<ServiceWorker | null>(null)
  const restartRequiredRef = useRef(false)
  const reloadingRef = useRef(false)

  const activateWorker = useCallback((worker: ServiceWorker) => {
    if (worker.state !== 'installed') {
      waitingWorkerRef.current = null
      restartRequiredRef.current = true
      setStatus('restart-required')
      return
    }

    reloadingRef.current = true
    restartRequiredRef.current = false
    setStatus('installing')
    try {
      worker.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      reloadingRef.current = false
      waitingWorkerRef.current = null
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      const unsupportedTimeout = window.setTimeout(() => setStatus('unsupported'), 0)
      return () => window.clearTimeout(unsupportedTimeout)
    }

    if (!isAppServiceWorkerEnabled(process.env.NODE_ENV)) {
      const wasControlled = Boolean(navigator.serviceWorker.controller)
      void clearDevelopmentServiceWorkerState(
        navigator.serviceWorker,
        'caches' in window ? window.caches : undefined,
      ).then((registrationState) => {
        if (wasControlled && registrationState !== 'failed') window.location.reload()
      })
      return
    }

    let modeTimeout: number | undefined
    try {
      const storedMode = normalizeAppUpdateMode(
        window.localStorage.getItem(APP_UPDATE_MODE_STORAGE_KEY),
      )
      modeRef.current = storedMode
      modeTimeout = window.setTimeout(() => setModeState(storedMode), 0)
    } catch {
      // Manual updates remain available when browser storage is unavailable.
    }

    let currentRegistration: ServiceWorkerRegistration | null = null
    let currentInstallingWorker: ServiceWorker | null = null
    let hasController = Boolean(navigator.serviceWorker.controller)
    let disposed = false

    const offerUpdate = (worker: ServiceWorker) => {
      waitingWorkerRef.current = worker
      if (modeRef.current === 'automatic') activateWorker(worker)
      else setStatus('available')
    }

    const handleInstallingState = () => {
      if (!currentInstallingWorker) return

      if (currentInstallingWorker.state === 'installed') {
        if (navigator.serviceWorker.controller) offerUpdate(currentInstallingWorker)
        else setStatus('current')
      } else if (currentInstallingWorker.state === 'redundant') {
        setStatus('error')
      }
    }

    const handleUpdateFound = () => {
      currentInstallingWorker?.removeEventListener('statechange', handleInstallingState)
      currentInstallingWorker = currentRegistration?.installing ?? null
      currentInstallingWorker?.addEventListener('statechange', handleInstallingState)
    }

    const bindRegistration = (registration: ServiceWorkerRegistration) => {
      currentRegistration = registration
      registrationRef.current = registration
      registration.addEventListener('updatefound', handleUpdateFound)

      if (registration.waiting) offerUpdate(registration.waiting)
      else if (registration.installing) handleUpdateFound()
      else setStatus('current')
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        if (disposed) return
        bindRegistration(registration)
      } catch {
        if (!disposed) setStatus('error')
      }
    }

    const handleControllerChange = () => {
      const isControlled = Boolean(navigator.serviceWorker.controller)
      const action = resolveControllerChange(hasController, isControlled, reloadingRef.current)
      hasController = isControlled
      reloadingRef.current = false
      waitingWorkerRef.current = null

      if (action === 'reload') {
        window.location.reload()
      } else if (action === 'restart-required') {
        if (modeRef.current === 'automatic') {
          restartRequiredRef.current = false
          window.location.reload()
        } else {
          restartRequiredRef.current = true
          setStatus('restart-required')
        }
      } else {
        restartRequiredRef.current = false
        setStatus('current')
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })

    return () => {
      disposed = true
      if (modeTimeout !== undefined) window.clearTimeout(modeTimeout)
      window.removeEventListener('load', register)
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      currentRegistration?.removeEventListener('updatefound', handleUpdateFound)
      currentInstallingWorker?.removeEventListener('statechange', handleInstallingState)
      registrationRef.current = null
      waitingWorkerRef.current = null
      restartRequiredRef.current = false
    }
  }, [activateWorker])

  const setMode = useCallback((nextMode: AppUpdateMode) => {
    modeRef.current = nextMode
    setModeState(nextMode)

    try {
      window.localStorage.setItem(APP_UPDATE_MODE_STORAGE_KEY, nextMode)
    } catch {
      // The preference still applies for this session if persistence is unavailable.
    }

    const waitingWorker = waitingWorkerRef.current ?? registrationRef.current?.waiting
    if (nextMode === 'automatic' && waitingWorker) {
      activateWorker(waitingWorker)
    } else if (nextMode === 'automatic' && restartRequiredRef.current) {
      window.location.reload()
    }
  }, [activateWorker])

  const checkForUpdate = useCallback(async () => {
    if (restartRequiredRef.current) {
      setStatus('restart-required')
      return
    }

    const registration = registrationRef.current
    if (!registration) {
      setStatus('unsupported')
      return
    }

    setStatus('checking')
    try {
      await registration.update()
      if (registration.waiting) {
        waitingWorkerRef.current = registration.waiting
        if (modeRef.current === 'automatic') activateWorker(registration.waiting)
        else setStatus('available')
      } else if (!registration.installing) {
        setStatus('current')
      }
    } catch {
      setStatus('error')
    }
  }, [activateWorker])

  const installUpdate = useCallback(() => {
    const waitingWorker = waitingWorkerRef.current ?? registrationRef.current?.waiting
    if (waitingWorker) {
      activateWorker(waitingWorker)
    } else if (restartRequiredRef.current) {
      window.location.reload()
    }
  }, [activateWorker])

  const value = useMemo<AppUpdateContextValue>(() => ({
    mode,
    status,
    setMode,
    checkForUpdate,
    installUpdate,
  }), [checkForUpdate, installUpdate, mode, setMode, status])

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>
}

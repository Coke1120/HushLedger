export const APP_UPDATE_MODE_STORAGE_KEY = 'hushledger:update-mode:v1'

export type AppUpdateMode = 'manual' | 'automatic'
export type ControllerChangeAction = 'current' | 'reload' | 'restart-required'

type AppServiceWorkerRegistration = {
  unregister: () => Promise<boolean>
}

type AppServiceWorkerContainer = {
  getRegistration: (clientUrl: string) => Promise<AppServiceWorkerRegistration | undefined>
}

type AppCacheStorage = {
  keys: () => Promise<string[]>
  delete: (cacheName: string) => Promise<boolean>
}

function isAppManagedCache(cacheName: string) {
  return cacheName.startsWith('hushledger-') || cacheName.startsWith('workbox-')
}

export function isAppServiceWorkerEnabled(environment: string | undefined) {
  return environment === 'production'
}

export async function clearDevelopmentServiceWorkerState(
  serviceWorkers: AppServiceWorkerContainer,
  cacheStorage?: AppCacheStorage,
) {
  const unregister = async () => {
    const registration = await serviceWorkers.getRegistration('/')
    if (!registration) return 'none' as const
    return await registration.unregister() ? 'unregistered' as const : 'none' as const
  }
  const clearCaches = async () => {
    if (!cacheStorage) return
    const names = await cacheStorage.keys()
    await Promise.all(
      names.filter(isAppManagedCache).map((name) => cacheStorage.delete(name)),
    )
  }

  const [unregisterResult] = await Promise.allSettled([unregister(), clearCaches()])
  return unregisterResult.status === 'fulfilled' ? unregisterResult.value : 'failed'
}

export function normalizeAppUpdateMode(value: unknown): AppUpdateMode {
  return value === 'automatic' ? 'automatic' : 'manual'
}

export function resolveControllerChange(
  wasControlled: boolean,
  isControlled: boolean,
  reloadArmed: boolean,
): ControllerChangeAction {
  if (reloadArmed) return 'reload'
  if (wasControlled && isControlled) return 'restart-required'
  return 'current'
}

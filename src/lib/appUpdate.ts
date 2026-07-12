export const APP_UPDATE_MODE_STORAGE_KEY = 'hushledger:update-mode:v1'

export type AppUpdateMode = 'manual' | 'automatic'
export type ControllerChangeAction = 'current' | 'reload' | 'restart-required'

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

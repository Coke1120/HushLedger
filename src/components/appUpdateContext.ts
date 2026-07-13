'use client'

import { createContext, useContext } from 'react'
import type { AppUpdateMode } from '../lib/appUpdate'

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'installing'
  | 'restart-required'
  | 'unsupported'
  | 'error'

export type AppUpdateContextValue = {
  mode: AppUpdateMode
  status: AppUpdateStatus
  setMode: (mode: AppUpdateMode) => void
  setRestartBlocked: (blocked: boolean) => void
  checkForUpdate: () => Promise<void>
  installUpdate: () => void
}

export const AppUpdateContext = createContext<AppUpdateContextValue | null>(null)

export function useAppUpdate() {
  const context = useContext(AppUpdateContext)
  if (!context) throw new Error('useAppUpdate must be used within AppUpdateProvider')
  return context
}

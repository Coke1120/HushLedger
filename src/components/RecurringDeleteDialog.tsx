import { LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import type { RecurringRule } from '../lib/schema'

type RecurringDeleteDialogProps = {
  rule: RecurringRule
  deleting: boolean
  onClose: () => void
  onConfirm: () => Promise<boolean>
}

export function RecurringDeleteDialog({ rule, deleting, onClose, onConfirm }: RecurringDeleteDialogProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const deletingRef = useRef(deleting)

  useEffect(() => {
    deletingRef.current = deleting
  }, [deleting])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('dialog-open')
    const focusFrame = requestAnimationFrame(() => cancelRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deletingRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('dialog-open')
      returnFocusRef.current?.focus()
    }
  }, [onClose])

  const confirm = async () => {
    const deleted = await onConfirm()
    if (deleted) onClose()
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !deleting && onClose()}
    >
      <div
        className="confirmation-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-recurring-title"
        aria-describedby="delete-recurring-description"
      >
        <button className="icon-button confirmation-close" type="button" onClick={onClose} disabled={deleting} aria-label={t('close')}>
          <X aria-hidden="true" />
        </button>
        <span className="confirmation-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2 id="delete-recurring-title">{t('deleteRecurringTitle', { name: rule.name })}</h2>
        <p id="delete-recurring-description">{t('deleteRecurringDescription', { count: rule.generatedCount })}</p>
        <div className="confirmation-actions">
          <button ref={cancelRef} className="button button-secondary" type="button" onClick={onClose} disabled={deleting}>
            {t('cancel')}
          </button>
          <button className="button button-danger" type="button" onClick={() => void confirm()} disabled={deleting}>
            {deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {deleting ? t('deleting') : t('confirmDelete')}
          </button>
        </div>
      </div>
    </div>
  )
}

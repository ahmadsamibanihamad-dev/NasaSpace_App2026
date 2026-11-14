import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from './primitives'

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('keydown', k)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[2500] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-[rgba(20,22,20,0.45)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-surface w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'} max-h-[92vh] overflow-y-auto rounded-t-card sm:rounded-card p-6 shadow-soft outline-none`}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-h2 font-semibold">{title}</h2>
          <IconButton icon="x" label={t('common.close')} onClick={onClose} size={36} />
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, body, confirmLabel, danger, busy, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} icon={danger ? 'trash' : undefined} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-text-secondary">{body}</p>
    </Modal>
  )
}

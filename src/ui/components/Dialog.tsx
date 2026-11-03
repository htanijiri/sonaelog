import { useEffect, useRef, type ReactNode } from 'react'

/** 確認・入力用のダイアログ。Esc と背景のクリックで閉じる */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

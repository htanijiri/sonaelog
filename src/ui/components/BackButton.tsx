import { useNavigate } from 'react-router'

export function BackButton({ fallback = '/items' }: { fallback?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="back"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))}
    >
      ← 戻る
    </button>
  )
}

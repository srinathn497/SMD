import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function ExpandableSection({ trigger, children, defaultOpen = false, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setOpen(v => !v)}>
        <div className="flex-1 min-w-0">{typeof trigger === 'function' ? trigger(open) : trigger}</div>
        <button
          type="button"
          className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0 p-1"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-dark-600/50">
          {children}
        </div>
      )}
    </div>
  )
}

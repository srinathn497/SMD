const VARIANTS = {
  // plain "selected" chip — no sentiment color, just marks the active choice (e.g. chart view toggle)
  neutral: {
    active:   'bg-dark-600 text-slate-100',
    inactive: 'text-slate-500 hover:text-slate-300',
  },
  // solid brand fill — for primary selectors like the chart interval picker
  solid: {
    active:   'bg-brand-500 text-dark-900',
    inactive: 'text-slate-500 hover:text-slate-200',
  },
  // low-opacity brand tint with border — for navigation-style tab bars
  tint: {
    active:   'bg-brand-500/10 text-brand-500 border border-brand-500/30',
    inactive: 'text-slate-500 hover:text-slate-300 hover:bg-dark-700/50 border border-transparent',
  },
}

export default function SegmentedControl({ options, value, onChange, variant = 'tint', wrap = false }) {
  const v = VARIANTS[variant] ?? VARIANTS.tint
  return (
    <div className={`flex gap-0.5 rounded-lg p-0.5 bg-dark-900/60 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map(({ key, label, icon: Icon }) => {
        const active = key === value
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors duration-150 ${
              active ? v.active : v.inactive
            } ${wrap ? '' : 'flex-1'}`}
          >
            {Icon && <Icon size={11} className="shrink-0" />}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function Ring({
  value,
  max,
  size = 64,          // px, outer wrapper width/height
  radius = 22,
  strokeWidth = 3,
  color,               // stroke color for the filled arc
  ringClassName = '',  // optional outer ring-2 border classes
  textClassName = 'text-slate-100',
  children,            // optional override for center content (defaults to value)
}) {
  const circ = 2 * Math.PI * radius
  const filled = max > 0 ? (value / max) * circ : 0

  return (
    <div
      className={`relative flex-shrink-0 rounded-full flex items-center justify-center ${ringClassName}`}
      style={{ width: size, height: size }}
    >
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-dark-600" />
        <circle
          cx="24" cy="24" r={radius} fill="none" strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          stroke={color}
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
      </svg>
      <span className={`z-10 font-bold ${textClassName}`}>{children ?? value}</span>
    </div>
  )
}

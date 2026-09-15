import { NavLink } from 'react-router-dom'
import { LayoutDashboard, TrendingUp, Briefcase, Bell, Sparkles, Activity, Star, Target, Zap, DollarSign } from 'lucide-react'

const links = [
  { to: '/',               label: 'Dashboard',        icon: LayoutDashboard },
  { to: '/trade-ideas',    label: 'Trade Ideas',      icon: Target },
  { to: '/smart-money',    label: 'Smart Money',      icon: Zap },
  { to: '/income',         label: 'Options Income',   icon: DollarSign },
  { to: '/recommendations',label: 'Recommendations',  icon: Sparkles },
  { to: '/interests',      label: 'Interests',        icon: Star },
  { to: '/trades',         label: 'Trades',           icon: Activity },
  { to: '/market',         label: 'Market',           icon: TrendingUp },
  { to: '/portfolio',      label: 'Portfolio',        icon: Briefcase },
  { to: '/alerts',         label: 'Alerts',           icon: Bell },
]

export default function Sidebar() {
  return (
    <aside className="w-56 min-h-screen bg-dark-800 border-r border-dark-700 flex flex-col">
      <div className="px-6 py-5 border-b border-dark-700">
        <h1 className="text-xl font-bold text-brand-500 tracking-wide">SMD</h1>
        <p className="text-xs text-slate-500 mt-0.5">Share Market Dashboard</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-dark-700 hover:text-slate-100'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-dark-700 text-xs text-slate-600">
        US Stocks + Crypto
      </div>
    </aside>
  )
}

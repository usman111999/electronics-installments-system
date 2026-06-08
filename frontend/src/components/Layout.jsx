import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { COMPANY_NAME, LOGO_URL } from '../branding';

const ICONS = {
  dashboard: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/>
      <rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>
    </svg>
  ),
  branches: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M9 18h.01M15 9h.01M15 12h.01M15 15h.01M15 18h.01"/>
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  roles: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  products: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  ),
  customers: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  orders: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11H1l8-8 8 8h-8v8H1"/>
    </svg>
  ),
  installments: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  ),
  activity: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  whatsapp: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  ),
  inventory: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7L12 3 4 7v10l8 4 8-4V7zM12 12V21M12 12L4 7M12 12l8-5"/>
    </svg>
  ),
  devices: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>
    </svg>
  ),
  shield: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  globe: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
};

// Declarative nav list — each item is filtered by hasPermission(requires).
// `requires: null` means "always visible (when section condition is met)".
const NAV = [
  // Main
  { section: 'Main', label: 'Dashboard', to: '/dashboard', icon: ICONS.dashboard, requires: 'stats.view' },

  // Operations
  { section: 'Sales',      label: 'Customers',    to: '/customers',    icon: ICONS.customers,    requires: 'customers.view' },
  { section: 'Sales',      label: 'Orders',       to: '/orders',       icon: ICONS.orders,       requires: 'orders.view' },
  { section: 'Sales',      label: 'Installments', to: '/installments', icon: ICONS.installments, requires: 'installments.view' },

  { section: 'Catalog',    label: 'Products & Stock', to: '/products', icon: ICONS.products,     requires: 'products.view' },

  { section: 'Operations', label: 'Devices',      to: '/devices',      icon: ICONS.devices,      requires: 'devices.view' },
  { section: 'Operations', label: 'WhatsApp',     to: '/whatsapp',     icon: ICONS.whatsapp,     requires: 'whatsapp.view' },
  { section: 'Operations', label: 'Activity Logs',to: '/activity',     icon: ICONS.activity,     requires: 'activity_logs.view' },

  // Admin
  { section: 'Admin', label: 'Branches', to: '/branches', icon: ICONS.branches, requires: 'branches.view' },
  { section: 'Admin', label: 'Users',    to: '/users',    icon: ICONS.users,    requires: 'users.view' },
  { section: 'Admin', label: 'Roles',    to: '/roles',    icon: ICONS.roles,    requires: 'roles.view' },

  // Super Admin (only visible when caller has these perms — super_admin gets '*')
  { section: 'Super Admin', label: 'System Overview', to: '/super-admin/overview', icon: ICONS.globe,   requires: 'stats.global_view' },
  { section: 'Super Admin', label: 'Admins',          to: '/super-admin/admins',   icon: ICONS.shield,  requires: 'admins.manage' },
  { section: 'Super Admin', label: 'Phones Registry', to: '/super-admin/phones',   icon: ICONS.devices, requires: 'devices.global_view' },
];

const CUSTOMER_NAV = [
  { to: '/portal', label: 'My Account', icon: ICONS.dashboard },
  { to: '/portal/installments', label: 'My Installments', icon: ICONS.installments },
  { to: '/portal/products', label: 'Products', icon: ICONS.products },
];

export default function Layout() {
  const { user, branch, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Mobile slide-in sidebar state. Closed by default on small screens; the
  // hamburger button toggles it. We auto-close on route change so navigation
  // doesn't leave the drawer open obscuring the new page.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Customer gets a fixed, simple nav (no permission gating).
  const isCustomer = user?.role === 'customer';

  // For non-customers, group visible items by section in declaration order.
  const sections = [];
  if (!isCustomer) {
    const order = [];
    const bySection = new Map();
    for (const item of NAV) {
      if (item.requires && !hasPermission(item.requires)) continue;
      if (!bySection.has(item.section)) { bySection.set(item.section, []); order.push(item.section); }
      bySection.get(item.section).push(item);
    }
    for (const name of order) sections.push({ name, items: bySection.get(name) });
  }

  return (
    <div className="flex h-full relative">
      {/* Mobile backdrop — appears only when drawer is open on <md screens */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden no-print"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: fixed slide-in on mobile, static column on md+. The
          `-translate-x-full` keeps it off-screen until mobileOpen flips it. */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 flex flex-col no-print
          transform transition-transform duration-200 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between">
          <Link to="/" className="block min-w-0 flex-1">
            <div className="h-12 w-full overflow-hidden rounded-lg bg-black flex items-center justify-center">
              <img src={LOGO_URL} alt={COMPANY_NAME} className="h-full w-auto object-contain" />
            </div>
            <div className="text-[11px] text-slate-400 capitalize truncate mt-1.5 text-center">{user?.role?.replace('_', ' ')} portal</div>
          </Link>
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1 hover:bg-slate-800 rounded text-slate-300"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {isCustomer
            ? CUSTOMER_NAV.map(it => (
                <NavLink key={it.to} to={it.to} end
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }>
                  {it.icon}<span>{it.label}</span>
                </NavLink>
              ))
            : sections.map(sec => (
                <div key={sec.name} className="pb-1 mt-2 first:mt-0 border-t border-slate-800/70 first:border-0">
                  <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                    {sec.name}
                  </div>
                  {sec.items.map(it => (
                    <NavLink key={it.to} to={it.to} end
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                          isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`
                      }>
                      {it.icon}
                      <span>{it.label}</span>
                    </NavLink>
                  ))}
                </div>
              ))}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="px-2 py-2 mb-2">
            <div className="text-xs text-slate-400">Signed in as</div>
            <div className="text-sm text-white font-medium truncate">{user?.full_name || user?.email}</div>
            {branch && <div className="text-xs text-slate-400 truncate">{branch.name}</div>}
            {!branch && user?.role === 'super_admin' && <div className="text-xs text-slate-400">Global access</div>}
          </div>
          <button onClick={handleLogout} className="w-full btn-secondary !bg-slate-800 !text-slate-200 !border-slate-700 hover:!bg-slate-700">
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile top bar with hamburger — invisible on md+ */}
        <div className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-200 flex items-center px-4 py-3 no-print">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 hover:bg-slate-100 rounded text-slate-700"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className="ml-3 flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-md bg-black overflow-hidden flex items-center justify-center shrink-0">
              <img src={LOGO_URL} alt={COMPANY_NAME} className="h-full w-auto object-contain" />
            </div>
            <div className="font-semibold text-slate-900 truncate">{COMPANY_NAME}</div>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

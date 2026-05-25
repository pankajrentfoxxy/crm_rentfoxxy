import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSupportUser } from '../utils/supportAccess';
import {
  BarChart3, CheckCircle, Archive, ClipboardList, Briefcase, Clock, Users,
  Package, Truck, Headphones, Building2, Laptop, Menu, X, LogOut, Settings,
  Search, Bell, ChevronDown, ChevronLeft, ChevronRight
} from 'lucide-react';
import { Avatar, PRIMARY, SIDEBAR_BG } from '../components/ui';

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const menuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/dashboard', roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager', 'sales'] },
    { icon: Archive, label: 'Inventory', path: '/inventory', roles: ['manager', 'admin', 'floor_manager'], permission: 'inventory_read', permissionAny: ['inventory_read', 'inventory_write', 'inventory_access'] },
    { icon: ClipboardList, label: 'Tickets', path: '/tickets', roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager'] },
    { icon: Briefcase, label: 'Leads', path: '/leads', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: Briefcase, label: 'Sales Orders', path: '/sales', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: Clock, label: 'Follow-ups', path: '/follow-ups', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: ClipboardList, label: 'Lead Orders', path: '/lead-orders', roles: ['manager', 'admin', 'sales'], permission: 'orders_access' },
    { icon: Users, label: 'Customers', path: '/customers', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: BarChart3, label: 'Manager Dashboard', path: '/manager-dashboard', roles: ['manager', 'admin'], permission: 'reports_access' },
    { icon: BarChart3, label: 'Reports', path: '/reports', roles: ['manager', 'admin', 'floor_manager'], permission: 'reports_access' },
    { icon: Package, label: 'Parts', path: '/parts', roles: ['manager', 'admin', 'floor_manager'], permission: 'parts_access' },
    { icon: Truck, label: 'Procurement', path: '/procurement', roles: ['manager', 'admin', 'procurement'], permission: 'procurement_access' },
    { icon: Package, label: 'Warehouse', path: '/warehouse', roles: ['manager', 'admin', 'warehouse'], permission: 'warehouse_access' },
    { icon: CheckCircle, label: 'QC Orders', path: '/qc-orders', roles: ['manager', 'admin', 'floor_manager', 'qc'], permission: 'qc_access' },
    { icon: Truck, label: 'Dispatch', path: '/dispatch', roles: ['manager', 'admin', 'floor_manager', 'dispatch'], permission: 'dispatch_access' },
    { type: 'section', label: 'Support' },
    { icon: Headphones, label: 'Support tickets', path: '/support/tickets', roles: ['admin', 'support_lead', 'support_tech'] },
    { icon: Building2, label: 'Customer Inventory', path: '/customer-inventory', roles: ['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'], permissionAny: ['customer_inventory_access'] },
    { type: 'section', label: 'Team' },
    { icon: Users, label: 'Teams', path: '/teams', roles: ['manager', 'admin'] },
  ];

  const visibleItems = menuItems.filter(item => {
    if (item.type === 'section') {
      if (item.label === 'Support') {
        return user && (['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'].includes(user.role) || isSupportUser(user));
      }
      return user && ['manager', 'admin'].includes(user.role);
    }
    const permMatch = item.permissionAny
      ? item.permissionAny.some(p => user.permissions?.includes(p))
      : (item.permission && user.permissions?.includes(item.permission));
    return !item.roles || (user && (item.roles.includes(user.role) || permMatch));
  });

  const activeItem = menuItems.find(item => item.path && (
    location.pathname === item.path ||
    (item.path !== '/dashboard' && location.pathname.startsWith(item.path))
  ));
  const pageTitle = activeItem?.label || 'Rentfoxxy';

  const isActive = (path) =>
    location.pathname === path ||
    (path !== '/dashboard' && location.pathname.startsWith(path));

  const sidebarWidth = collapsed ? 72 : 240;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
      background: '#f0f6fc'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #c8d8e8; border-radius: 4px; }
      `}</style>

      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
          className="lg:hidden"
        />
      )}

      <header style={{
        height: 64,
        background: SIDEBAR_BG,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 20,
        boxShadow: '0 2px 10px rgba(2,67,123,0.15)',
        zIndex: 30,
        flexShrink: 0,
        color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.15)'
      }}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 6 }}
        >
          <Menu size={22} />
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: sidebarWidth,
          transition: 'width .25s',
          overflow: 'hidden',
          flexShrink: 0
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <Laptop size={21} color="#fff" />
          </div>
          {!collapsed && (
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
              Rentfoxxy
            </span>
          )}
        </div>

        <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginLeft: 8, whiteSpace: 'nowrap' }}>
          {pageTitle}
        </div>

        <div style={{ flex: 1, maxWidth: 360, position: 'relative', marginLeft: 12 }} className="hidden md:block">
          <Search size={15} color="rgba(255,255,255,0.6)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input placeholder="Search..." style={{
            width: '100%',
            padding: '8px 12px 8px 36px',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 12,
            fontSize: 13,
            color: '#fff',
            background: 'rgba(255,255,255,0.08)',
            outline: 'none'
          }} />
        </div>

        <div style={{ flex: 1 }} />

        <button style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.85)', position: 'relative', padding: 6, borderRadius: 10
        }}>
          <Bell size={18} />
        </button>

        <div style={{ position: 'relative' }} ref={profileRef}>
          <button onClick={() => setProfileOpen(!profileOpen)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 12, padding: '4px 12px 4px 6px',
            cursor: 'pointer', color: '#fff'
          }}>
            <Avatar name={user?.name} size={28} />
            <div style={{ textAlign: 'left' }} className="hidden sm:block">
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#fff' }}>{user?.name}</p>
              <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' }}>{user?.role?.replace(/_/g, ' ')}</p>
            </div>
            <ChevronDown size={14} color="rgba(255,255,255,0.7)" />
          </button>
          {profileOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)', background: '#fff',
              border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              padding: 8, minWidth: 180, zIndex: 100
            }}>
              {[
                { icon: Settings, label: 'Settings', action: () => setProfileOpen(false) },
                { icon: LogOut, label: 'Sign out', action: handleLogout },
              ].map(({ icon: Icon, label, action }) => (
                <button key={label} onClick={action} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px',
                  background: 'none', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13,
                  color: label === 'Sign out' ? '#ef4444' : '#0f172a', fontWeight: 500
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          position: 'relative', zIndex: 50, display: 'flex', flexShrink: 0,
          transform: sidebarOpen ? 'translateX(0)' : undefined
        }}
          className={`fixed lg:relative inset-y-0 left-0 top-16 lg:top-0 h-[calc(100vh-64px)] lg:h-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} transition-transform duration-200`}
        >
          <div style={{
            width: sidebarWidth, minWidth: sidebarWidth,
            background: SIDEBAR_BG, display: 'flex', flexDirection: 'column',
            transition: 'width .25s, min-width .25s', overflow: 'hidden',
            boxShadow: '2px 0 20px rgba(2,67,123,0.1)', height: '100%'
          }}>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden"
              style={{
                position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.15)',
                border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#fff', zIndex: 10
              }}
            >
              <X size={18} />
            </button>

            <nav style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {visibleItems.map((item) => {
                if (item.type === 'section') {
                  return !collapsed ? (
                    <div key={`section-${item.label}`} style={{ padding: '12px 14px 4px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {item.label}
                      </span>
                    </div>
                  ) : (
                    <div key={`section-${item.label}`} style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '8px 10px' }} />
                  );
                }

                const { icon: Icon, label, path } = item;
                const active = isActive(path);

                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setSidebarOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: collapsed ? '10px 0' : '10px 14px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderRadius: 12, border: 'none', cursor: 'pointer', textDecoration: 'none',
                      background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                      color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                      fontWeight: active ? 600 : 400, fontSize: 13,
                      transition: 'background .2s, color .2s', whiteSpace: 'nowrap',
                      boxShadow: active ? '0 2px 10px rgba(0,0,0,0.15)' : 'none',
                      width: '100%'
                    }}
                    onMouseEnter={e => {
                      if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={e => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = active ? '#fff' : 'rgba(255,255,255,0.65)';
                    }}
                  >
                    <Icon size={18} />
                    {!collapsed && label}
                  </Link>
                );
              })}
            </nav>

            {!collapsed && (
              <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                Powered by Rentfoxxy Ops
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex"
            style={{
              position: 'absolute', top: 20, right: -14, width: 28, height: 28,
              borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff',
              color: PRIMARY, cursor: 'pointer', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(2,67,123,0.15)', zIndex: 20
            }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        <main style={{ flex: 1, overflowY: 'auto', background: '#f0f6fc' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Headphones, Menu, X, LogOut, Plus, List } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead } from '../../utils/supportAccess';

export default function SupportLayout({ children }) {
    const [open, setOpen] = useState(false);
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const nav = [
        { to: '/support/tickets', label: 'Tickets', icon: List },
        ...(isSupportLead(user) ? [{ to: '/support/tickets/new', label: 'New ticket', icon: Plus }] : [])
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                        onClick={() => setOpen(!open)}
                        aria-label="Menu"
                    >
                        {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                    <Headphones className="w-6 h-6 text-indigo-600" />
                    <span className="font-bold text-slate-900">Support</span>
                </div>
                <span className="text-sm text-slate-600 hidden sm:block">{user?.name}</span>
                <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-1 text-sm text-slate-600 min-h-[44px] px-2"
                >
                    <LogOut className="w-4 h-4" /> Logout
                </button>
            </header>

            <div className="flex">
                <aside
                    className={`${open ? 'block' : 'hidden'} lg:block w-full lg:w-56 border-r border-slate-200 bg-white lg:min-h-[calc(100vh-57px)]`}
                >
                    <nav className="p-3 space-y-1">
                        {nav.map(({ to, label, icon: Icon }) => (
                            <Link
                                key={to}
                                to={to}
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-2 px-3 py-3 rounded-lg hover:bg-slate-100 text-sm font-medium min-h-[44px]"
                            >
                                <Icon className="w-5 h-5 text-indigo-600" />
                                {label}
                            </Link>
                        ))}
                    </nav>
                </aside>
                <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">{children}</main>
            </div>
        </div>
    );
}

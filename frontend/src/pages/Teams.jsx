import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Teams() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate('/settings/users', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 max-w-md">
        <div className="text-4xl mb-4">🔄</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          Teams has moved
        </h2>
        <p className="text-gray-500 text-sm mb-6">
          User and team management is now in <strong>Settings → Users</strong>.
          You can assign users to teams from the User edit drawer.
        </p>
        <Link
          to="/settings/users"
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to User Management
        </Link>
        <p className="text-xs text-gray-400 mt-4">Redirecting automatically in 3 seconds...</p>
      </div>
    </div>
  );
}

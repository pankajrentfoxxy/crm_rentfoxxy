import React, { useCallback, useEffect, useMemo, useState } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, leaving: false }]);

    const leaveTimer = setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, 2700);

    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);

    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  return { toasts, setToasts, showToast };
}

const TYPE_STYLES = {
  success: {
    icon: '?',
    border: 'border-l-4 border-l-green-500',
    iconColor: 'text-green-700',
  },
  error: {
    icon: '?',
    border: 'border-l-4 border-l-red-500',
    iconColor: 'text-red-700',
  },
  info: {
    icon: '?',
    border: 'border-l-4 border-l-blue-500',
    iconColor: 'text-blue-700',
  },
};

function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    return () => {
      onRemove(toast.id);
    };
  }, [onRemove, toast.id]);

  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;

  return (
    <div
      className={`bg-white border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 min-w-64 ${style.border} transition-all duration-300 ${
        toast.leaving ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
      }`}
    >
      <span className={`text-sm font-semibold ${style.iconColor}`}>{style.icon}</span>
      <p className="text-sm text-gray-700">{toast.message}</p>
    </div>
  );
}

export function ToastContainer({ toasts, setToasts }) {
  const remove = useMemo(
    () => (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [setToasts]
  );

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={remove} />
      ))}
    </div>
  );
}

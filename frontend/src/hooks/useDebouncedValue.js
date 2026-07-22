import { useEffect, useState } from 'react';

/** Debounce a value — useful for search inputs (default 320ms). */
export default function useDebouncedValue(value, delay = 320) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}

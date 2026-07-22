import { useEffect, useState } from 'react';
import { fetchFloorCounts } from '../floorPipelineApi';

export function useFloorCounts(enabled = true) {
  const [counts, setCounts] = useState({
    all_tickets: 0,
    qc_queue: 0,
    chip_level: 0,
    body_paint: 0,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetchFloorCounts()
      .then((res) => {
        if (!cancelled && res?.data?.counts) setCounts(res.data.counts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);

  return { counts };
}

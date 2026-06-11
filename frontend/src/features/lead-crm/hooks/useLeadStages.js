import { useEffect, useState } from 'react';
import { getLeadStages } from '../leadCrmApi';

let cache = null;
let cachePromise = null;

export function useLeadStages() {
  const [stagesByStatus, setStagesByStatus] = useState(cache || {});
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) {
      setStagesByStatus(cache);
      setLoading(false);
      return undefined;
    }
    if (!cachePromise) {
      cachePromise = getLeadStages()
        .then((res) => {
          const map = {};
          (res.data?.stages || []).forEach(({ status, stages }) => {
            map[status] = stages || [];
          });
          cache = map;
          return map;
        })
        .catch(() => ({}))
        .finally(() => { cachePromise = null; });
    }
    cachePromise.then((map) => {
      setStagesByStatus(map);
      setLoading(false);
    });
    return undefined;
  }, []);

  return { stagesByStatus, loading };
}

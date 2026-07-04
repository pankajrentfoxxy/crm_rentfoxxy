import { useEffect, useState } from 'react';
import { fetchInventorySpecFilterOptions } from '../../../utils/assetConfigurationApi';

const EMPTY_OPTIONS = {
  brands: [],
  models: [],
  processors: [],
  generations: [],
  rams: [],
  storages: [],
  gpus: [],
  screen_sizes: [],
};

export default function useInventorySpecFilterOptions(enabled = true) {
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchInventorySpecFilterOptions()
      .then(({ data }) => {
        if (cancelled || !data?.success) return;
        setOptions({
          brands: data.brands || [],
          models: data.models || [],
          processors: data.processors || [],
          generations: data.generations || [],
          rams: data.rams || [],
          storages: data.storages || [],
          gpus: data.gpus || [],
          screen_sizes: data.screen_sizes || [],
        });
      })
      .catch(() => {
        if (!cancelled) setOptions(EMPTY_OPTIONS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  return { options, loading };
}

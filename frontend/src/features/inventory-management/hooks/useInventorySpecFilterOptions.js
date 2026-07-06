import { useEffect, useMemo, useState } from 'react';
import { fetchCascadeSpecMasters, fetchLaptopSpecMapping } from '../../../utils/assetConfigurationApi';
import { buildSpecFilterOptionsFromLaptopTree } from '../utils/laptopSpecFilterOptions';

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

const EMPTY_SPEC_MASTERS = {
  rams: [],
  storages: [],
  gpus: [],
  screen_sizes: [],
};

/**
 * Spec filter options sourced from Laptop Configuration mappings (/asset-configuration/laptop).
 * Brand-scoped models/processors/generations are derived synchronously from the mapping tree.
 */
export default function useInventorySpecFilterOptions(brand = '', enabled = true) {
  const [laptopTree, setLaptopTree] = useState([]);
  const [specMasters, setSpecMasters] = useState(EMPTY_SPEC_MASTERS);
  const [loading, setLoading] = useState(false);
  const brandKey = (brand || '').trim();

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);

    Promise.all([fetchLaptopSpecMapping(), fetchCascadeSpecMasters()])
      .then(([mapRes, specRes]) => {
        if (cancelled) return;
        setLaptopTree(mapRes.data?.brands || []);
        const masters = specRes.data || {};
        setSpecMasters({
          rams: masters.rams || [],
          storages: masters.storages || [],
          gpus: masters.gpus || [],
          screen_sizes: masters.screen_sizes || [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLaptopTree([]);
          setSpecMasters(EMPTY_SPEC_MASTERS);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled]);

  const options = useMemo(
    () => buildSpecFilterOptionsFromLaptopTree(laptopTree, brandKey, specMasters),
    [laptopTree, brandKey, specMasters],
  );

  return { options: loading ? EMPTY_OPTIONS : options, loading };
}

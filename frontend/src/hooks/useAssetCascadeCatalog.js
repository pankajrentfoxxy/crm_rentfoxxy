import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCascadeBrands,
  fetchCascadeGenerations,
  fetchCascadeModels,
  fetchCascadeProcessors,
  fetchCascadeSpecMasters,
} from '../utils/assetConfigurationApi';

const emptySpecs = () => ({ rams: [], storages: [], gpus: [], screen_sizes: [] });

export default function useAssetCascadeCatalog(enabled = true) {
  const [brands, setBrands] = useState([]);
  const [specMasters, setSpecMasters] = useState(emptySpecs);
  const [modelsByBrand, setModelsByBrand] = useState({});
  const [processorsByBrand, setProcessorsByBrand] = useState({});
  const [generationsByBrand, setGenerationsByBrand] = useState({});
  const [loadingBase, setLoadingBase] = useState(false);
  const loadedBrands = useRef(new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoadingBase(true);
    Promise.all([fetchCascadeBrands(), fetchCascadeSpecMasters()])
      .then(([brandRes, specRes]) => {
        if (cancelled) return;
        setBrands((brandRes.data?.brands || []).map((row) => row.name));
        setSpecMasters({
          rams: specRes.data?.rams || [],
          storages: specRes.data?.storages || [],
          gpus: specRes.data?.gpus || [],
          screen_sizes: specRes.data?.screen_sizes || [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setBrands([]);
          setSpecMasters(emptySpecs());
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBase(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  const loadBrandData = useCallback(async (brandName) => {
    if (!enabled || !brandName || loadedBrands.current.has(brandName)) return;
    loadedBrands.current.add(brandName);
    try {
      const [procRes, modelRes, genRes] = await Promise.all([
        fetchCascadeProcessors(brandName),
        fetchCascadeModels(brandName),
        fetchCascadeGenerations(brandName),
      ]);
      setProcessorsByBrand((prev) => ({
        ...prev,
        [brandName]: procRes.data?.processors || [],
      }));
      setModelsByBrand((prev) => ({
        ...prev,
        [brandName]: modelRes.data?.models || [],
      }));
      setGenerationsByBrand((prev) => ({
        ...prev,
        [brandName]: genRes.data?.generations || [],
      }));
    } catch {
      loadedBrands.current.delete(brandName);
    }
  }, [enabled]);

  const prefetchLine = useCallback((line) => {
    if (!line?.brand) return;
    loadBrandData(line.brand);
  }, [loadBrandData]);

  return {
    loadingBase,
    brands,
    specMasters,
    modelsByBrand,
    processorsByBrand,
    generationsByBrand,
    loadBrandData,
    prefetchLine,
  };
}

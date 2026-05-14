import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchPricing } from '@/lib/api';
import type { ModelPrice } from '@/utils/usage';

export interface UsePricingDataOptions {
  onAuthRequired?: () => void;
  enabled?: boolean;
}

export interface UsePricingDataReturn {
  modelPrices: Record<string, ModelPrice>;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  loadPricing: () => Promise<void>;
}

const pricingToModelPrice = (entry: {
  model: string;
  prompt_price_per_1m: number;
  completion_price_per_1m: number;
  cache_price_per_1m: number;
}): ModelPrice => ({
  prompt: entry.prompt_price_per_1m,
  completion: entry.completion_price_per_1m,
  cache: entry.cache_price_per_1m,
});

export function usePricingData(options: UsePricingDataOptions = {}): UsePricingDataReturn {
  const { onAuthRequired, enabled = true } = options;
  const [modelPrices, setModelPricesState] = useState<Record<string, ModelPrice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const loadPricing = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    setLoading(true);
    setError('');

    try {
      const pricingResponse = await fetchPricing(controller.signal);
      if (requestControllerRef.current !== controller) {
        return;
      }
      const prices = Object.fromEntries(
        pricingResponse.pricing.map((entry) => [entry.model, pricingToModelPrice(entry)])
      );
      setModelPricesState(prices);
      setLastRefreshedAt(new Date());
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setModelPricesState({});
      setError(error instanceof Error ? error.message : 'Failed to load pricing');
    } finally {
      if (requestControllerRef.current === controller) {
        setLoading(false);
        requestControllerRef.current = null;
      }
    }
  }, [onAuthRequired]);

  useEffect(() => {
    if (!enabled) {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      setLoading(false);
      return;
    }
    void loadPricing();
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [enabled, loadPricing]);

  return {
    modelPrices,
    loading,
    error,
    lastRefreshedAt,
    loadPricing,
  };
}

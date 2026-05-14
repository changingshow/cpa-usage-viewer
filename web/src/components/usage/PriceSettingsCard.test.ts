import { describe, expect, it } from 'vitest';
import { getSortedModelPriceEntries } from './PriceSettingsCard';

describe('getSortedModelPriceEntries', () => {
  it('sorts configured model prices by display name', () => {
    const entries = getSortedModelPriceEntries({
      'priced-zeta': { prompt: 3, completion: 15, cache: 0.3 },
      'priced-alpha': { prompt: 2, completion: 8, cache: 0.2 },
    });

    expect(entries.map(([model]) => model)).toEqual(['priced-alpha', 'priced-zeta']);
  });
});

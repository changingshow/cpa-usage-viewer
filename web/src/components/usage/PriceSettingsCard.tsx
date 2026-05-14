import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { ModelPrice } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

const formatDisplayName = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '-';
  return normalized;
};

export interface PriceSettingsCardProps {
  modelPrices: Record<string, ModelPrice>;
  loading?: boolean;
}

function PriceSettingsTitle({ title, subtitle, eyebrow }: { title: string; subtitle: string; eyebrow: string }) {
  return (
    <div className={styles.sectionTitleBlock}>
      <span className={styles.sectionEyebrow}>{eyebrow}</span>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <p className={styles.sectionSubtitle}>{subtitle}</p>
    </div>
  );
}

export const getSortedModelPriceEntries = (modelPrices: Record<string, ModelPrice>): Array<[string, ModelPrice]> => (
  Object.entries(modelPrices).sort(([left], [right]) => formatDisplayName(left).localeCompare(formatDisplayName(right)))
);

export function PriceSettingsCard({
  modelPrices,
  loading = false
}: PriceSettingsCardProps) {
  const { t } = useTranslation();
  const priceEntries = getSortedModelPriceEntries(modelPrices);

  return (
    <Card
      title={
        <PriceSettingsTitle
          eyebrow={t('usage_stats.model_price_settings_eyebrow')}
          title={t('usage_stats.model_price_settings_title')}
          subtitle={t('usage_stats.model_price_settings_subtitle')}
        />
      }
      className={`${styles.detailsFixedCard} ${styles.pricingFixedCard}`}
    >
      <div className={styles.pricingSection}>
        {loading && priceEntries.length === 0 ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : (
          <div className={styles.pricesList}>
            <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
            {priceEntries.length > 0 ? (
              <div className={styles.pricesGrid}>
                {priceEntries.map(([model, price]) => (
                  <div key={model} className={styles.priceItem}>
                    <div className={styles.priceInfo}>
                      <span className={styles.priceModel}>{formatDisplayName(model)}</span>
                      <div className={styles.priceMeta}>
                        <span>
                          {t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M
                        </span>
                        <span>
                          {t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M
                        </span>
                        <span>
                          {t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

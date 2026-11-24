// 技能目录的桶是列表筛选的唯一维度（spec #200 / T4）。目录页与共用详情页的
// 返回出口都要读它，取值与缺省必须同源，否则「返回时回到原桶」会在非法/缺失
// 参数上漂移。
export const CATALOG_BUCKETS = ['all', 'platform', 'org', 'granted'] as const;

export type CatalogBucket = (typeof CATALOG_BUCKETS)[number];

/** 读取 URL query 里的桶；缺失或非法值回落到全量视图。 */
export function readCatalogBucket(value: unknown): CatalogBucket {
  return typeof value === 'string' && (CATALOG_BUCKETS as readonly string[]).includes(value)
    ? (value as CatalogBucket)
    : 'all';
}

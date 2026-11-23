<template>
  <section data-test="skill-catalog">
    <div class="catalog-hero">
      <h1 class="catalog-title">{{ t('skillCatalog.title') }}</h1>
      <p class="catalog-subtitle">{{ t('skillCatalog.subtitle') }}</p>
      <el-radio-group v-model="bucket" class="catalog-buckets" data-test="catalog-bucket">
        <el-radio-button v-for="option in BUCKET_OPTIONS" :key="option.value" :value="option.value">
          {{ t(option.labelKey) }}
        </el-radio-button>
      </el-radio-group>
      <el-input
        v-model="searchInput"
        class="catalog-search"
        size="large"
        clearable
        data-test="catalog-search-input"
        :placeholder="t('skillCatalog.searchPlaceholder')"
        @keyup.enter="submitSearch"
        @clear="submitSearch"
      >
        <template #append>
          <el-button data-test="catalog-search-submit" @click="submitSearch">
            {{ t('skillCatalog.search') }}
          </el-button>
        </template>
      </el-input>
    </div>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      :closable="false"
      data-test="catalog-error"
    />

    <div v-loading="loading" class="catalog-list" data-test="catalog-list">
      <el-empty v-if="!loading && items.length === 0" :description="emptyDescription" data-test="catalog-empty" />
      <article v-for="item in items" :key="item.identity" class="catalog-card" data-test="catalog-item">
        <div class="catalog-card-main">
          <router-link
            class="catalog-card-title"
            :to="detailTarget(item)"
            data-test="catalog-item-link"
            @click="rememberScrollPosition"
          >
            {{ item.displayName || item.skillName }}
          </router-link>
          <div class="catalog-card-identity">{{ item.identity }}</div>
          <p class="catalog-card-description">{{ item.description || t('skill.noDescription') }}</p>
          <div class="catalog-card-meta">
            <el-tag v-if="item.latestStableVersion" size="small" type="success">
              {{ item.latestStableVersion }}
            </el-tag>
            <el-tag
              size="small"
              :type="item.visibility === 'private' ? 'warning' : 'info'"
              data-test="catalog-item-visibility"
            >
              {{ t(item.visibility === 'private' ? 'skillCatalog.visibilityPrivate' : 'skillCatalog.visibilityPublic') }}
            </el-tag>
            <span class="catalog-item-namespace" data-test="catalog-item-namespace">
              <el-tag size="small" :type="item.namespaceKind === 'organization' ? 'primary' : 'info'">
                {{ t(item.namespaceKind === 'organization' ? 'skill.namespaceTypeOrganization' : 'skill.namespaceTypePersonal') }}
              </el-tag>
              <span class="catalog-item-namespace-name">{{ item.namespaceName }}</span>
            </span>
            <span class="catalog-downloads">{{ t('skillCatalog.downloads', { count: item.downloadCount }) }}</span>
          </div>
          <div
            v-if="item.visibility === 'private'"
            class="catalog-item-source"
            data-test="catalog-item-source"
          >
            {{ sourceText(item) }}
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { readCatalogBucket, type CatalogBucket } from '../../skills/catalog-query';
import { useAuthStore } from '../../stores/auth';

// 个人控制台「技能目录」（spec #200 / T4）：消费登录态目录 API，展示当前主体
// 此刻有权安装的全部已发布技能。桶与关键词是列表的唯二筛选维度，二者 AND 叠加，
// 并双向同步到 URL query，便于分享、刷新和 T5 从详情页返回时恢复原视图。

interface CatalogItem {
  identity: string;
  scope: string;
  skillName: string;
  displayName: string;
  description: string;
  latestStableVersion?: string;
  visibility: string;
  downloadCount: number;
  namespaceKind: 'organization' | 'personal';
  namespaceName: string;
  bucket: 'platform' | 'org' | 'granted';
  source: { kind: 'organization' | 'person' | 'self'; name: string };
}

const BUCKET_OPTIONS = [
  { value: 'all', labelKey: 'skillCatalog.bucketAll' },
  { value: 'platform', labelKey: 'skillCatalog.bucketPlatform' },
  { value: 'org', labelKey: 'skillCatalog.bucketOrg' },
  { value: 'granted', labelKey: 'skillCatalog.bucketGranted' }
] as const;

const { t } = useLocaleState();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const bucket = ref<CatalogBucket>(readCatalogBucket(route.query.bucket));
const searchInput = ref<string>(typeof route.query.q === 'string' ? route.query.q : '');
const appliedQuery = ref<string>(searchInput.value.trim());
const items = ref<CatalogItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const emptyDescription = computed<string>(() => {
  if (appliedQuery.value) return t('skillCatalog.emptySearch');
  // 无组织新用户（spec AC5）：「我的组织」桶永远为空，给专门引导而不是泛泛的空桶。
  if (bucket.value === 'org' && auth.organizations.length === 0) {
    return t('skillCatalog.emptyOrgNoOrganization');
  }
  if (bucket.value === 'all') return t('skillCatalog.emptyAll');
  return t('skillCatalog.emptyBucket');
});

// 只写回两个筛选维度；用 replace 避免每次输入都往历史栈压一条记录。
function syncQuery(): void {
  const next: Record<string, string> = { bucket: bucket.value };
  if (appliedQuery.value) next.q = appliedQuery.value;
  const current = new URLSearchParams(
    Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  ).toString();
  if (current === new URLSearchParams(next).toString()) return;
  void router.replace({ query: next });
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const params = new URLSearchParams({ bucket: bucket.value });
    if (appliedQuery.value) params.set('q', appliedQuery.value);
    items.value = await apiRequest<CatalogItem[]>(`/api/catalog/skills?${params.toString()}`);
    await nextTick();
    restoreScrollPosition();
  } catch (error) {
    errorMessage.value = formatRequestError(error) || t('skillCatalog.loadFailed');
  } finally {
    loading.value = false;
  }
}

// 从目录进入详情时记下离开前的滚动位置；回到同一筛选视图后尽力恢复（V1 不承诺
// 精确位置）。sessionStorage 只在本次标签页有效，且用后即删，避免别的列表误用。
const SCROLL_KEY = 'esl-skill-catalog-scroll';

function rememberScrollPosition(): void {
  try {
    sessionStorage.setItem(
      SCROLL_KEY,
      JSON.stringify({ top: window.scrollY, bucket: bucket.value, q: appliedQuery.value })
    );
  } catch {
    // 记录失败不影响导航。
  }
}

function restoreScrollPosition(): void {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCROLL_KEY);
    const saved = JSON.parse(raw) as { top?: unknown; bucket?: unknown; q?: unknown };
    // 只恢复同一个筛选视图；换了桶或关键词时列表内容不同，旧位置没有意义。
    if (saved.bucket !== bucket.value || saved.q !== appliedQuery.value) return;
    if (typeof saved.top !== 'number' || saved.top <= 0) return;
    window.scrollTo({ top: saved.top });
  } catch {
    // 尽力恢复；失败不阻断浏览。
  }
}

function onBucketChange(): void {
  syncQuery();
  void load();
}

function submitSearch(): void {
  appliedQuery.value = searchInput.value.trim();
  syncQuery();
  void load();
}

// 卡片跳共用详情页（/skills/:scope/:skillName），并带上返回恢复上下文：
// traffic_source 固定为 skill_catalog（与 T6 漏斗事件字段同名），bucket 与 q 供 T5
// 渲染「返回技能目录」时恢复原视图。
function detailTarget(item: CatalogItem): { name: string; params: Record<string, string>; query: Record<string, string> } {
  const query: Record<string, string> = {
    traffic_source: 'skill_catalog',
    bucket: bucket.value
  };
  if (appliedQuery.value) query.q = appliedQuery.value;
  return {
    name: 'public-skill-detail',
    params: { scope: item.scope, skillName: item.skillName },
    query
  };
}

// private 卡片额外一行来源：组织名 / 授权方（技能所属个人命名空间）/「我的技能」。
// 团队名与授权档位不在消费侧展示，API 也不下发，这里无需兜底。
function sourceText(item: CatalogItem): string {
  if (item.source.kind === 'organization') {
    return t('skillCatalog.sourceOrganization', { name: item.source.name });
  }
  if (item.source.kind === 'person') {
    return t('skillCatalog.sourcePerson', { name: item.source.name });
  }
  return t('skillCatalog.sourceSelf');
}

// 浏览器前进/后退或直接打开带参 URL 时，让界面跟随 URL 重新加载。桶本身有独立
// watcher（负责写回 URL 并加载），这里只在桶未变、仅关键词变化时补一次加载。
watch(
  () => [route.query.bucket, route.query.q],
  () => {
    const nextBucket = readCatalogBucket(route.query.bucket);
    const nextQuery = typeof route.query.q === 'string' ? route.query.q : '';
    const bucketChanged = nextBucket !== bucket.value;
    if (!bucketChanged && nextQuery === searchInput.value && nextQuery.trim() === appliedQuery.value) {
      return;
    }
    bucket.value = nextBucket;
    searchInput.value = nextQuery;
    appliedQuery.value = nextQuery.trim();
    if (!bucketChanged) void load();
  }
);

watch(bucket, onBucketChange);
onMounted(load);
</script>

<style scoped>
.catalog-hero {
  padding: 24px 0 20px;
}

.catalog-title {
  margin: 0;
  color: var(--ink-900);
  font-size: var(--fs-2xl);
}

.catalog-subtitle {
  margin: 8px 0 20px;
  color: var(--ink-500);
}

.catalog-buckets {
  display: flex;
  margin-bottom: 16px;
}

.catalog-search {
  max-width: 560px;
}

.catalog-list {
  display: grid;
  gap: 12px;
  min-height: 120px;
}

.catalog-card {
  padding: 18px 20px;
  background: #fff;
  border: 1px solid var(--paper-200);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.catalog-card-title {
  color: var(--celadon-600);
  font-size: var(--fs-lg);
  font-weight: 600;
}

.catalog-card-identity {
  margin-top: 2px;
  color: var(--ink-400);
  font-family: var(--font-family-mono);
  font-size: var(--fs-xs);
}

.catalog-card-description {
  margin: 10px 0;
  color: var(--ink-700);
}

.catalog-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.catalog-item-namespace {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.catalog-item-namespace-name {
  color: var(--ink-700);
  font-family: var(--font-family-mono);
  font-size: var(--fs-xs);
}

.catalog-item-source {
  margin-top: 8px;
  color: var(--ink-500);
  font-size: var(--fs-xs);
}

.catalog-downloads {
  color: var(--ink-500);
  font-size: var(--fs-xs);
}
</style>

<template>
  <section>
    <div class="catalog-hero">
      <h1 class="catalog-title">{{ t('catalog.title') }}</h1>
      <p class="catalog-subtitle">{{ t('catalog.subtitle') }}</p>
      <el-input
        v-model="query"
        class="catalog-search"
        size="large"
        clearable
        data-test="catalog-search-input"
        :placeholder="t('catalog.searchPlaceholder')"
        @keyup.enter="load"
        @clear="load"
      >
        <template #append>
          <el-button data-test="catalog-search-submit" @click="load">{{ t('catalog.search') }}</el-button>
        </template>
      </el-input>
    </div>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="catalog-error" />

    <div v-loading="loading" class="catalog-list" data-test="catalog-list">
      <el-empty v-if="!loading && items.length === 0" :description="t('catalog.empty')" data-test="catalog-empty" />
      <article v-for="item in items" :key="item.name" class="catalog-card" data-test="catalog-item">
        <div class="catalog-card-main">
          <router-link
            class="catalog-card-title"
            :to="detailPath(item)"
            data-test="catalog-item-link"
          >
            {{ item.displayName || item.name }}
          </router-link>
          <div class="catalog-card-identity">{{ item.name }}</div>
          <p class="catalog-card-description">{{ item.description || t('skill.noDescription') }}</p>
          <div class="catalog-card-meta">
            <el-tag v-if="item.latestStableVersion" size="small" type="success">
              {{ item.latestStableVersion }}
            </el-tag>
            <el-tag v-if="item.visibility" size="small" :type="visibilityTagType(item.visibility)">
              {{ visibilityText(item.visibility) }}
            </el-tag>
            <span class="catalog-downloads">
              {{ t('catalog.downloads', { count: item.downloadCount ?? 0 }) }}
            </span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiRequest } from '../../api/client';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { visibilityTagType, visibilityTextKey } from '../../skills/visibility';

interface CatalogItem {
  name: string;
  scope?: string;
  skillName?: string;
  displayName?: string;
  description: string;
  latestStableVersion?: string;
  visibility?: string;
  downloadCount?: number;
}

const { t } = useLocaleState();
const items = ref<CatalogItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const query = ref('');

function detailPath(item: CatalogItem): string {
  const scope = item.scope ?? item.name.replace(/^@/, '').split('/')[0];
  const skillName = item.skillName ?? item.name.split('/')[1];
  return `/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}`;
}

function visibilityText(visibility: string): string {
  return t(visibilityTextKey(visibility));
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const trimmed = query.value.trim();
    const suffix = trimmed ? `?q=${encodeURIComponent(trimmed)}` : '';
    items.value = await apiRequest<CatalogItem[]>(`/api/skills/search${suffix}`);
  } catch (error) {
    errorMessage.value = formatRequestError(error) || t('catalog.loadFailed');
  } finally {
    loading.value = false;
  }
}

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
  text-decoration: none;
}

.catalog-card-title:hover {
  text-decoration: underline;
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

.catalog-downloads {
  color: var(--ink-500);
  font-size: var(--fs-xs);
}
</style>

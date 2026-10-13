<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar skill-overview-toolbar">
        <span class="toolbar-caption">{{ t('skill.platformSkills') }}</span>
        <el-select
          v-model="namespaceFilter"
          data-test="namespace-filter"
          :placeholder="t('skill.namespacePlaceholder')"
          :aria-label="t('skill.namespacePlaceholder')"
          clearable
          filterable
          class="namespace-filter"
        >
          <el-option v-for="scope in namespaces" :key="scope" :label="`@${scope}`" :value="scope" />
        </el-select>
      </div>
      <el-table :data="pagedRows" data-test="super-skills-table" v-loading="loading">
        <el-table-column :label="t('skill.name')" min-width="240">
          <template #default="{ row }">
            <SkillIdentity :skill="row" />
          </template>
        </el-table-column>
        <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
        <el-table-column :label="t('columns.downloadCount')" width="100">
          <template #default="{ row }">
            <span :data-test="`download-count-${row.skillName}`">{{ formatNumber(row.downloadCount ?? 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.status')" width="100">
          <template #default="{ row }">{{ t(statusText(row.status)) }}</template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="140">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`configure-${row.skillName}`"
              @click="openPermissions(row.scope, row.skillName)"
            >
              {{ t('actions.manage') }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span v-if="!loading && !errorMessage">{{ t(namespaceFilter ? 'skill.noNamespaceSkills' : 'skill.noPlatformSkills') }}</span>
        </template>
      </el-table>
      <div class="skill-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="visibleRows.length"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :disabled="loading"
          data-test="skill-pagination"
        />
      </div>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import SkillIdentity from '../../components/SkillIdentity.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRouter } from 'vue-router';
import { loadSkillInventorySummaries, statusText, type SkillInventoryItem } from '../../skills/skill-list';

const { t, formatNumber } = useLocaleState();

const router = useRouter();

const rows = ref<SkillInventoryItem[]>([]);
const namespaceFilter = ref('');
const namespaces = computed(() => [...new Set(rows.value.map((row) => row.scope))].sort());
const visibleRows = computed(() => namespaceFilter.value
  ? rows.value.filter((row) => row.scope === namespaceFilter.value)
  : rows.value);
const currentPage = ref(1);
const pageSize = ref(20);
const pagedRows = computed(() => visibleRows.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value));
watch([namespaceFilter, pageSize], () => { currentPage.value = 1; });
const loading = ref(false);
const errorMessage = ref('');

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'super-skill-manage',
    params: { scope, skillName }
  });
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    // 超级管理员视角:服务端返回跨组织全部技能(含未发布与冻结组织,ADR-0025)
    rows.value = await loadSkillInventorySummaries();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.namespace-filter {
  width: 220px;
}

.skill-overview-toolbar {
  flex-wrap: wrap;
}

@media (max-width: 600px) {
  .namespace-filter {
    width: 100%;
  }
}

.page-error {
  margin-top: 16px;
}
</style>

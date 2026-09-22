<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-table :data="rows" data-test="super-skills-table" v-loading="loading">
        <el-table-column :label="t('skill.name')">
          <template #default="{ row }">
            <span v-if="row.displayName" data-test="skill-display-name">{{ row.displayName }}</span>
            <code class="skill-path">{{ row.name }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="scope" :label="t('columns.organization')" width="140" />
        <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
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
      </el-table>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRouter } from 'vue-router';
import { loadSkillInventorySummaries, statusText, type SkillInventoryItem } from '../../skills/skill-list';

const { t } = useLocaleState();

const router = useRouter();

const rows = ref<SkillInventoryItem[]>([]);
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
.page-error {
  margin-top: 16px;
}
</style>

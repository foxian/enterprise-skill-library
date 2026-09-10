<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-table :data="rows" data-test="super-skills-table" v-loading="loading">
        <el-table-column prop="name" label="技能名" />
        <el-table-column prop="scope" label="组织" width="140" />
        <el-table-column prop="createdBy" label="创建者" width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ statusText(row.status) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`configure-${row.skillName}`"
              @click="openPermissions(row.scope, row.skillName)"
            >
              配置权限
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
import { useRouter } from 'vue-router';
import { loadSkillInventorySummaries, statusText, type SkillInventoryItem } from '../../skills/skill-list';

const router = useRouter();

const rows = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'super-skill-permissions',
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
    errorMessage.value = error instanceof Error ? error.message : String(error);
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

<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-table :data="rows" data-test="org-skills-table" v-loading="loading">
        <el-table-column prop="name" label="技能名" />
        <el-table-column prop="createdBy" label="创建者" width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ statusText(row.status) }}</template>
        </el-table-column>
        <el-table-column label="共享状态" width="140">
          <template #default="{ row }">
            <el-tag :type="row.state.tagType" :data-test="`skill-state-${row.skillName}`">{{ row.state.text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`configure-${row.skillName}`"
              @click="openPermissions(row.scope, row.skillName)"
            >
              管理
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
import {
  deriveShareState,
  loadSkillInventorySummaries,
  statusText,
  type PermissionMatrix,
  type SkillInventoryItem
} from '../../skills/skill-list';

const router = useRouter();

interface SkillRow extends SkillInventoryItem {
  state: ReturnType<typeof deriveShareState>;
}

const rows = ref<SkillRow[]>([]);
const loading = ref(false);
const errorMessage = ref('');

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'org-skill-manage',
    params: { scope, skillName }
  });
}

function fallbackMatrix(item: SkillInventoryItem): PermissionMatrix {
  return {
    scope: item.scope,
    skillName: item.skillName,
    sharedAllRead: false,
    sharedAllWrite: false,
    sharedAllManage: false,
    teams: [],
    members: []
  };
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    // 服务端已按组织管理员身份收敛到本组织全部技能(含未发布,ADR-0025)
    const items = await loadSkillInventorySummaries();
    rows.value = items.map((item) => ({
      ...item,
      state: deriveShareState(item.matrix ?? fallbackMatrix(item))
    }));
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

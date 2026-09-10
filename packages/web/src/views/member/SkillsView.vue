<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="我管理的" name="managed">
          <el-table :data="managedRows" data-test="member-skills-table" v-loading="loading">
            <el-table-column prop="name" label="技能名" />
            <el-table-column prop="createdBy" label="创建者" width="160" />
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
                  配置权限
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="共享给我的" name="shared">
          <el-table :data="sharedRows" data-test="member-shared-table" v-loading="loading">
            <el-table-column prop="name" label="技能名" />
            <el-table-column prop="createdBy" label="创建者" width="160" />
            <el-table-column label="我的权限" width="120">
              <template #default="{ row }">
                <el-tag type="info">{{ accessText(row.access) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">{{ statusText(row.status) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  accessText,
  deriveShareState,
  loadSkillInventorySummaries,
  statusText,
  type PermissionMatrix,
  type SkillInventoryItem
} from '../../skills/skill-list';

const router = useRouter();

interface ManagedRow extends SkillInventoryItem {
  state: ReturnType<typeof deriveShareState>;
}

const activeTab = ref<'managed' | 'shared'>('managed');
const managedRows = ref<ManagedRow[]>([]);
const sharedRows = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'member-skill-permissions',
    params: { scope, skillName }
  });
}

// 没有矩阵读取权限(或读取失败)的技能按默认私有展示共享状态
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
    const items = await loadSkillInventorySummaries();
    managedRows.value = items
      .filter((item) => item.relation === 'managed')
      .map((item) => ({ ...item, state: deriveShareState(item.matrix ?? fallbackMatrix(item)) }));
    sharedRows.value = items.filter((item) => item.relation === 'shared');
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

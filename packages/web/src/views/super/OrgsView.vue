<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">共 {{ orgs.length }} 个组织</span>
      </div>

      <el-table :data="orgs" data-test="orgs-table" v-loading="loading">
        <el-table-column prop="name" label="组织名" />
        <el-table-column label="生命周期" width="120">
          <template #default="{ row }">
            <el-tag :type="orgStatusTagType(row.status)" :data-test="`org-status-${row.name}`">
              {{ orgStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="memberCount" label="成员数" width="100" />
        <el-table-column prop="skillCount" label="技能数" width="100" />
        <el-table-column label="创建时间" width="200">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button link type="primary" :data-test="`org-detail-${row.name}`" @click="openDetail(row.name)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />

  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
  status?: string | null;
  lastError?: string | null;
}

const orgs = ref<OrgSummary[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const router = useRouter();


function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function openDetail(name: string): void {
  void router.push({ name: 'super-org-detail', params: { orgName: name } });
}

async function loadOrgs(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    orgs.value = await apiRequest<OrgSummary[]>('/api/admin/orgs');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadOrgs();
});
</script>

<style scoped>
.console-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.toolbar-caption {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}

code {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.page-error {
  margin-top: 16px;
}
</style>

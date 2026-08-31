<template>
  <div>
    <h2>全平台组织</h2>
    <el-table :data="orgs" data-test="orgs-table" v-loading="loading">
      <el-table-column prop="name" label="组织名" />
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
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
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

onMounted(async () => {
  loading.value = true;
  try {
    orgs.value = await apiRequest<OrgSummary[]>('/api/admin/orgs');
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

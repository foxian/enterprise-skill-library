<template>
  <div>
    <h2>平台概览</h2>
    <el-row :gutter="16">
      <el-col :span="8">
        <el-card data-test="stat-orgs">
          <el-statistic title="组织总数" :value="orgs.length" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card data-test="stat-pending">
          <el-statistic title="待审批申请" :value="pendingCount" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card data-test="stat-skills">
          <el-statistic title="平台技能总数" :value="skillTotal" />
        </el-card>
      </el-col>
    </el-row>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiRequest } from '../../api/client';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
}

interface ApplicationView {
  id: number;
  orgName: string;
  adminDisplayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const orgs = ref<OrgSummary[]>([]);
const applications = ref<ApplicationView[]>([]);
const errorMessage = ref('');

const pendingCount = computed(() => applications.value.filter((item) => item.status === 'pending').length);
const skillTotal = computed(() => orgs.value.reduce((total, org) => total + org.skillCount, 0));

onMounted(async () => {
  try {
    const [orgList, applicationList] = await Promise.all([
      apiRequest<OrgSummary[]>('/api/admin/orgs'),
      apiRequest<ApplicationView[]>('/api/admin/orgs/applications')
    ]);
    orgs.value = orgList;
    applications.value = applicationList;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

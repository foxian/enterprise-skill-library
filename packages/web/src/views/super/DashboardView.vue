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
    <el-card data-test="platform-status" style="margin-top: 16px">
      <template #header>平台状态</template>
      <template v-if="bootstrapStatus">
        <el-tag :type="bootstrapStatus.ready ? 'success' : 'warning'" data-test="bootstrap-ready">
          {{ bootstrapStatus.ready ? 'Bootstrap 就绪' : 'Bootstrap 未就绪' }}
        </el-tag>
        <span class="status-detail">
          Gitea：{{ bootstrapStatus.gitea }} / 管理员 token：{{ bootstrapStatus.adminToken }} / 平台仓库：{{
            bootstrapStatus.repoOwner
          }}
        </span>
      </template>
      <el-skeleton v-else :rows="1" animated />
    </el-card>
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

interface BootstrapStatus {
  ready: boolean;
  gitea: 'ready' | 'missing';
  adminToken: 'ready' | 'missing' | 'invalid';
  repoOwner: 'ready' | 'missing';
}

const orgs = ref<OrgSummary[]>([]);
const applications = ref<ApplicationView[]>([]);
const bootstrapStatus = ref<BootstrapStatus | null>(null);
const errorMessage = ref('');

const pendingCount = computed(() => applications.value.filter((item) => item.status === 'pending').length);
const skillTotal = computed(() => orgs.value.reduce((total, org) => total + org.skillCount, 0));

onMounted(async () => {
  try {
    const [orgList, applicationList, status] = await Promise.all([
      apiRequest<OrgSummary[]>('/api/admin/orgs'),
      apiRequest<ApplicationView[]>('/api/admin/orgs/applications'),
      apiRequest<BootstrapStatus>('/api/admin/bootstrap/status')
    ]);
    orgs.value = orgList;
    applications.value = applicationList;
    bootstrapStatus.value = status;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}

.status-detail {
  margin-left: 12px;
  color: #909399;
  font-size: 13px;
}
</style>

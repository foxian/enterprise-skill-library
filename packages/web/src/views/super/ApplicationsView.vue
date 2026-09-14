<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">按状态筛选申请</span>
        <el-select v-model="statusFilter" data-test="status-filter" style="width: 160px">
          <el-option label="待审批" value="pending" />
          <el-option label="已批准" value="approved" />
          <el-option label="已拒绝" value="rejected" />
          <el-option label="全部" value="all" />
        </el-select>
      </div>

      <el-table :data="filteredApplications" data-test="applications-table" v-loading="loading">
      <el-table-column prop="orgName" label="组织名" />
      <el-table-column prop="applicantUsername" label="申请人" />
      <el-table-column label="申请时间" width="180">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="orgStatusTagType(row.status)">{{ orgStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button link type="success" :data-test="`approve-${row.id}`" @click="approve(row)">批准</el-button>
            <el-button link type="warning" :data-test="`cancel-${row.id}`" @click="cancel(row)">取消</el-button>
            <el-button link type="danger" :data-test="`reject-${row.id}`" @click="reject(row)">拒绝</el-button>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>

  <el-dialog v-model="resultDialogVisible" title="组织开通" width="440px">
    <p>
      组织 <strong>{{ handledOrgName }}</strong> 已同步开通，申请人已加入该组织并成为
      组织管理团队成员（无需初始密码：成员是全局账号，用自己的凭据登录）。
    </p>
    <template #footer>
      <el-button type="primary" data-test="initial-password-close" @click="resultDialogVisible = false">
        知道了
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

interface ApplicationView {
  id: number;
  orgName: string;
  applicantUsername: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const applications = ref<ApplicationView[]>([]);
const statusFilter = ref('pending');
const loading = ref(false);
const errorMessage = ref('');
const resultDialogVisible = ref(false);
const handledOrgName = ref('');

const filteredApplications = computed(() =>
  statusFilter.value === 'all'
    ? applications.value
    : applications.value.filter((item) => item.status === statusFilter.value)
);

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

async function loadApplications(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    applications.value = await apiRequest<ApplicationView[]>('/api/admin/orgs/applications');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function approve(application: ApplicationView): Promise<void> {
  try {
    const result = await apiRequest<{ status: string; orgName: string; applicant: string }>(
      `/api/admin/orgs/applications/${application.id}/approve`,
      { method: 'POST' }
    );
    handledOrgName.value = result.orgName;
    resultDialogVisible.value = true;
    await loadApplications();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function reject(application: ApplicationView): Promise<void> {
  try {
    await apiRequest(`/api/admin/orgs/applications/${application.id}/reject`, { method: 'POST' });
    ElMessage.success(`已拒绝 ${application.orgName} 的注册申请`);
    await loadApplications();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function cancel(application: ApplicationView): Promise<void> {
  try {
    await apiRequest(`/api/admin/orgs/applications/${application.id}/cancel`, { method: 'POST' });
    ElMessage.success(`已取消 ${application.orgName} 的注册申请`);
    await loadApplications();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(loadApplications);
</script>

<style scoped>
.toolbar-caption {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.page-error {
  margin-top: 16px;
}
</style>

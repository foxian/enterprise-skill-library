<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">{{ t('orgApproval.filterByStatus') }}</span>
        <el-select v-model="statusFilter" data-test="status-filter" style="width: 160px">
          <el-option :label="t('status.pending')" value="pending" />
          <el-option :label="t('status.approved')" value="approved" />
          <el-option :label="t('status.rejected')" value="rejected" />
          <el-option :label="t('actions.all')" value="all" />
        </el-select>
      </div>

      <el-table :data="filteredApplications" data-test="applications-table" v-loading="loading">
      <el-table-column prop="orgName" :label="t('columns.organizationName')" />
      <el-table-column prop="applicantUsername" :label="t('columns.applicant')" />
      <el-table-column :label="t('columns.appliedAt')" width="180">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.status')" width="100">
        <template #default="{ row }">
          <el-tag :type="orgStatusTagType(row.status)">{{ t(orgStatusText(row.status)) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.actions')" width="200">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button link type="success" :data-test="`approve-${row.id}`" @click="approve(row)">{{ t('actions.approve') }}</el-button>
            <el-button link type="warning" :data-test="`cancel-${row.id}`" @click="cancel(row)">{{ t('actions.cancel') }}</el-button>
            <el-button link type="danger" :data-test="`reject-${row.id}`" @click="reject(row)">{{ t('actions.reject') }}</el-button>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>

  <el-dialog v-model="resultDialogVisible" :title="t('registration.provisionedTitle')" width="440px">
    <p>
      {{ t('orgApproval.provisionedDetail', { org: handledOrgName }) }}
    </p>
    <template #footer>
      <el-button type="primary" data-test="initial-password-close" @click="resultDialogVisible = false">
        {{ t('actions.close') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

const { t, formatDate } = useLocaleState();

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

async function loadApplications(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    applications.value = await apiRequest<ApplicationView[]>('/api/admin/orgs/applications');
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    errorMessage.value = formatRequestError(error);
  }
}

async function reject(application: ApplicationView): Promise<void> {
  try {
    await apiRequest(`/api/admin/orgs/applications/${application.id}/reject`, { method: 'POST' });
    ElMessage.success(t('orgApproval.applicationRejected', { org: application.orgName }));
    await loadApplications();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function cancel(application: ApplicationView): Promise<void> {
  try {
    await apiRequest(`/api/admin/orgs/applications/${application.id}/cancel`, { method: 'POST' });
    ElMessage.success(t('orgApproval.applicationCancelled', { org: application.orgName }));
    await loadApplications();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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

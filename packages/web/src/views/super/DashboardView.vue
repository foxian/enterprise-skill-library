<template>
  <div>
    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card" data-test="stat-orgs" shadow="never">
          <div class="stat-card-icon primary">
            <el-icon><OfficeBuilding /></el-icon>
          </div>
        <p class="stat-card-title">{{ t('dashboard.totalOrganizations') }}</p>
          <p class="stat-card-value">{{ orgs.length }}</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card" data-test="stat-pending" shadow="never">
          <div class="stat-card-icon warning">
            <el-icon><Tickets /></el-icon>
          </div>
        <p class="stat-card-title">{{ t('dashboard.pendingApplications') }}</p>
          <p class="stat-card-value">{{ pendingCount }}</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card" data-test="stat-skills" shadow="never">
          <div class="stat-card-icon info">
            <el-icon><Files /></el-icon>
          </div>
        <p class="stat-card-title">{{ t('dashboard.totalSkills') }}</p>
          <p class="stat-card-value">{{ skillTotal }}</p>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="status-card" data-test="platform-status" shadow="never" style="margin-top: 16px">
      <template #header>
        <span class="status-card-title">{{ t('dashboard.platformStatus') }}</span>
      </template>
      <template v-if="bootstrapStatus">
        <div class="status-row">
          <el-tag :type="bootstrapStatus.ready ? 'success' : 'warning'" data-test="bootstrap-ready" size="large">
        {{ bootstrapStatus.ready ? t('status.bootstrapReady') : t('status.bootstrapNotReady') }}
          </el-tag>
          <div class="status-details">
            <div class="status-item">
              <span class="status-item-label">Gitea</span>
              <span class="status-item-value">{{ bootstrapStatus.gitea }}</span>
            </div>
            <div class="status-item">
        <span class="status-item-label">{{ t('dashboard.adminToken') }}</span>
              <span class="status-item-value">{{ bootstrapStatus.adminToken }}</span>
            </div>
            <div class="status-item">
        <span class="status-item-label">{{ t('dashboard.platformRepository') }}</span>
              <span class="status-item-value">{{ bootstrapStatus.repoOwner }}</span>
            </div>
          </div>
        </div>
      </template>
      <el-skeleton v-else :rows="1" animated />
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { OfficeBuilding, Tickets, Files } from '@element-plus/icons-vue';
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

const { t } = useLocaleState();

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
    errorMessage.value = formatRequestError(error);
  }
});
</script>

<style scoped>
.status-card-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>


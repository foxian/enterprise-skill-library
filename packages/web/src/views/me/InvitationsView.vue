<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">{{ t('invitation.title') }}</span>
      </div>

      <el-table v-if="invitations.length > 0" :data="invitations" data-test="invitations-table" v-loading="loading">
        <el-table-column :label="t('columns.organization')" min-width="180">
          <template #default="{ row }">@{{ row.orgName }}</template>
        </el-table-column>
        <el-table-column prop="invitedBy" :label="t('columns.inviter')" width="180" />
        <el-table-column :label="t('columns.actions')" width="200">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`accept-invitation-${row.orgName}`"
              @click="respond(row.id, 'accept')"
            >
              {{ t('actions.accept') }}
            </el-button>
            <el-button
              link
              type="danger"
              :data-test="`decline-invitation-${row.orgName}`"
              @click="respond(row.id, 'decline')"
            >
              {{ t('actions.reject') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && invitations.length === 0" :description="t('invitation.empty')" />

      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { useAuthStore, type SessionOrganization } from '../../stores/auth';

const { t } = useLocaleState();

interface Invitation {
  id: number;
  orgName: string;
  invitedBy: string;
}

const auth = useAuthStore();
const invitations = ref<Invitation[]>([]);
const loading = ref(false);
const errorMessage = ref('');

async function loadInvitations(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    invitations.value = await apiRequest<Invitation[]>('/api/orgs/invitations');
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

async function respond(id: number, action: 'accept' | 'decline'): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/invitations/${id}/${action}`, { method: 'POST' });
    ElMessage.success(action === 'accept' ? t('invitation.accepted') : t('invitation.declined'));
    await loadInvitations();
    if (action === 'accept') {
      // 接受后组织隶属关系变了，刷新会话里的组织列表
      const mine = await apiRequest<{ organizations: SessionOrganization[] }>('/api/orgs/mine');
      if (auth.session) {
        auth.establish({ ...auth.session, organizations: mine.organizations });
      }
    }
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

onMounted(loadInvitations);
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

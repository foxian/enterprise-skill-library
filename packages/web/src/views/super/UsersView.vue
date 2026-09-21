<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar user-toolbar">
        <el-input
          v-model="search"
          data-test="user-search"
          :placeholder="t('userManagement.searchPlaceholder')"
          clearable
          @keyup.enter="load"
        />
        <el-select v-model="status" data-test="user-status-filter" @change="load">
          <el-option value="all" :label="t('userManagement.allStatuses')" />
          <el-option value="enabled" :label="t('userManagement.enabled')" />
          <el-option value="disabled" :label="t('userManagement.disabled')" />
        </el-select>
        <el-button type="primary" data-test="user-search-submit" @click="load">
          {{ t('userManagement.search') }}
        </el-button>
        <el-button type="primary" data-test="provision-user-open" @click="openProvisionDialog">
          {{ t('userManagement.provisionUser') }}
        </el-button>
      </div>

      <el-table :data="users" data-test="users-table" v-loading="loading">
        <el-table-column prop="username" :label="t('registration.username')" />
        <el-table-column :label="t('userManagement.email')" min-width="240">
          <template #default="{ row }">
            <span>{{ row.email }}</span>
            <el-tag
              v-if="row.emailPendingCompletion"
              type="warning"
              size="small"
              class="row-tag"
              :data-test="`email-pending-${row.username}`"
            >
              {{ t('userManagement.emailPendingCompletion') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.status')" width="120">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" :data-test="`user-status-${row.username}`">
              {{ row.enabled ? t('userManagement.enabled') : t('userManagement.disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="220">
          <template #default="{ row }">
            <el-button
              v-if="row.enabled"
              link
              type="danger"
              :data-test="`disable-user-${row.username}`"
              @click="setEnabled(row, false)"
            >
              {{ t('userManagement.disable') }}
            </el-button>
            <el-button
              v-else
              link
              type="success"
              :data-test="`enable-user-${row.username}`"
              @click="setEnabled(row, true)"
            >
              {{ t('userManagement.enable') }}
            </el-button>
            <el-button
              link
              type="primary"
              :data-test="`edit-email-${row.username}`"
              @click="openEmailDialog(row)"
            >
              {{ t('userManagement.editEmail') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />

    <el-dialog v-model="provisionVisible" :title="t('userManagement.provisionUser')" width="480px" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="t('registration.username')" required>
          <el-input v-model="provisionUsername" data-test="provision-username" />
        </el-form-item>
        <el-form-item :label="t('userManagement.email')" required>
          <el-input v-model="provisionEmail" data-test="provision-email" />
        </el-form-item>
        <el-form-item :label="t('userManagement.initialPassword')" required>
          <el-input v-model="provisionPassword" data-test="provision-password" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="provisionVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          data-test="provision-user-submit"
          :loading="saving"
          @click="provisionUser"
        >
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="emailVisible" :title="t('userManagement.editEmail')" width="440px" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="t('userManagement.email')" required>
          <el-input v-model="emailValue" data-test="edit-user-email" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="emailVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" data-test="edit-user-email-submit" :loading="saving" @click="changeEmail">
          {{ t('common.save') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { formatRequestError, useLocaleState } from '../../i18n/locale';

interface UserRow {
  username: string;
  email: string;
  enabled: boolean;
  emailPendingCompletion: boolean;
}

const { t } = useLocaleState();
const users = ref<UserRow[]>([]);
const search = ref('');
const status = ref<'all' | 'enabled' | 'disabled'>('all');
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');

const provisionVisible = ref(false);
const provisionUsername = ref('');
const provisionEmail = ref('');
const provisionPassword = ref('');

const emailVisible = ref(false);
const emailUsername = ref('');
const emailValue = ref('');

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('search', search.value.trim());
    if (status.value !== 'all') params.set('status', status.value);
    const query = params.toString();
    users.value = await apiRequest<UserRow[]>(`/api/admin/users${query ? `?${query}` : ''}`);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

function openProvisionDialog(): void {
  provisionUsername.value = '';
  provisionEmail.value = '';
  provisionPassword.value = '';
  provisionVisible.value = true;
}

async function provisionUser(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    await apiRequest('/api/admin/users', {
      method: 'POST',
      body: {
        username: provisionUsername.value.trim(),
        email: provisionEmail.value.trim(),
        password: provisionPassword.value
      }
    });
    ElMessage.success(t('userManagement.provisioned'));
    provisionVisible.value = false;
    await load();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    saving.value = false;
  }
}

async function setEnabled(row: UserRow, enabled: boolean): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(row.username)}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST'
    });
    ElMessage.success(t(enabled ? 'userManagement.enabledMessage' : 'userManagement.disabledMessage', {
      username: row.username
    }));
    await load();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

function openEmailDialog(row: UserRow): void {
  emailUsername.value = row.username;
  emailValue.value = row.email;
  emailVisible.value = true;
}

async function changeEmail(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(emailUsername.value)}/email`, {
      method: 'PUT',
      body: { email: emailValue.value.trim() }
    });
    ElMessage.success(t('userManagement.emailChanged'));
    emailVisible.value = false;
    await load();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.user-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.user-toolbar :deep(.el-input) {
  max-width: 360px;
}

.user-toolbar :deep(.el-select) {
  width: 150px;
}

.row-tag {
  margin-left: 8px;
}

.page-error {
  margin-top: 16px;
}
</style>

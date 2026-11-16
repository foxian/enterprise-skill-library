<template>
  <div>
    <el-card id="email" class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('profile.emailTitle') }}</span>
          <el-tag
            v-if="profile && (profile.emailPendingVerification || profile.emailPendingCompletion)"
            type="warning"
            size="small"
            data-test="email-pending-reminder"
          >
            {{ profile.emailPendingVerification ? t('profile.emailPendingVerification') : t('userManagement.emailPendingCompletion') }}
          </el-tag>
        </div>
      </template>
      <p v-if="profile" class="profile-email" data-test="profile-email">{{ profile.email }}</p>
      <el-alert
        v-if="profile && (profile.emailPendingVerification || profile.emailPendingCompletion)"
        type="warning"
        :title="t('profile.emailPendingHint')"
        :closable="false"
        class="profile-alert"
      />
      <el-form label-position="top" class="profile-form" @submit.prevent="changeEmail">
        <el-form-item :label="t('profile.newEmail')" required>
          <el-input v-model="newEmail" data-test="profile-email-input" />
        </el-form-item>
        <el-form-item :label="t('profile.currentPassword')" required>
          <el-input
            v-model="currentPassword"
            data-test="profile-current-password"
            type="password"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="savingEmail"
          data-test="profile-email-submit"
        >
          {{ t('profile.saveEmail') }}
        </el-button>
      </el-form>
    </el-card>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { apiRequest } from '../../api/client';
import { ElMessage } from 'element-plus';

const { t } = useLocaleState();

interface AccountProfile {
  username: string;
  email: string;
  emailPendingCompletion: boolean;
  emailPendingVerification?: boolean;
}

const profile = ref<AccountProfile | null>(null);
const newEmail = ref('');
const currentPassword = ref('');
const savingEmail = ref(false);
const errorMessage = ref('');

async function loadProfile(): Promise<void> {
  errorMessage.value = '';
  try {
    profile.value = await apiRequest<AccountProfile>('/api/account/profile');
    newEmail.value = profile.value.email;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function changeEmail(): Promise<void> {
  savingEmail.value = true;
  errorMessage.value = '';
  try {
    profile.value = await apiRequest<AccountProfile>('/api/account/email', {
      method: 'PUT',
      body: {
        email: newEmail.value.trim(),
        currentPassword: currentPassword.value
      }
    });
    currentPassword.value = '';
    ElMessage.success(
      profile.value.emailPendingVerification
        ? t('profile.emailVerificationSent')
        : t('profile.emailChanged')
    );
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    savingEmail.value = false;
  }
}

onMounted(loadProfile);
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-error {
  margin-top: 16px;
}

.profile-email {
  margin: 0 0 12px;
  font-weight: 600;
}

.profile-alert {
  margin-bottom: 16px;
}

.profile-form {
  max-width: 520px;
}
</style>

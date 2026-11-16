<template>
  <div>
    <el-card
      id="email"
      class="data-card personal-info-card"
      :class="{ 'is-highlighted': highlighted }"
      shadow="never"
      data-test="personal-info-card"
    >
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
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { apiRequest } from '../../api/client';
import { ElMessage } from 'element-plus';

const { t } = useLocaleState();
const route = useRoute();

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
const highlighted = ref(false);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

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

onMounted(async () => {
  await loadProfile();
  // 概览页横幅带着 #email 锚点跳转过来：落位到邮箱区块并短暂高亮，帮助用户聚焦。
  if (route.hash === '#email') {
    const target = document.getElementById('email');
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    highlighted.value = true;
    highlightTimer = setTimeout(() => {
      highlighted.value = false;
    }, 2000);
  }
});

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer);
});
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

.personal-info-card {
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

.personal-info-card.is-highlighted {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-7);
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

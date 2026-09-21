<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">{{ t('registration.title') }}</h2>
      </div>
      <p class="auth-subtitle">{{ t('registration.subtitle') }}</p>
      <LocaleSwitch class="auth-locale-switch" />

      <el-result
        v-if="pending"
        data-test="register-pending"
        icon="warning"
        :title="t('registration.pendingTitle')"
        :sub-title="t('registration.pendingSubtitle', { username: pending })"
      />
      <el-result
        v-else-if="registered"
        data-test="register-success"
        icon="success"
        :title="t('registration.successTitle')"
        :sub-title="t('registration.successSubtitle', { username: registered })"
      >
        <template #extra>
          <router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link>
        </template>
      </el-result>

      <el-form v-else label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('registration.username')" required>
          <el-input v-model="username" data-test="register-username" :placeholder="t('registration.usernamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('registration.email')" required>
          <el-input v-model="email" data-test="register-email" :placeholder="t('registration.emailPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('registration.password')" required>
          <el-input v-model="password" data-test="register-password" type="password" show-password />
        </el-form-item>
        <el-form-item :label="t('registration.confirmPassword')" required>
          <el-input v-model="confirmPassword" data-test="register-confirm" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="register-error" />
        <el-button
          type="primary"
          class="auth-submit"
          native-type="submit"
          :loading="loading"
          data-test="register-submit"
        >
          {{ t('registration.submit') }}
        </el-button>
      </el-form>
      <router-link to="/admin/login" class="auth-link" data-test="login-link">{{ t('registration.existingAccount') }}</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiRequest } from '../api/client';
import { useLocaleState } from '../i18n/locale';
import LocaleSwitch from '../components/LocaleSwitch.vue';
import { formatRequestError } from '../i18n/locale';

const username = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorMessage = ref('');
const registered = ref('');
const pending = ref('');
const { t } = useLocaleState();

onMounted(() => {
  // 注册模式只影响服务端行为（open 直接建号 / approval 建号后待审），
  // 前端不按模式改表单，按响应状态展示结果。
});

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!username.value.trim() || !email.value.trim() || !password.value) {
    errorMessage.value = t('registration.credentialsRequired');
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = t('registration.passwordsDoNotMatch');
    return;
  }
  loading.value = true;
  try {
    const result = await apiRequest<{ status: string; username: string }>('/api/auth/register', {
      method: 'POST',
      body: { username: username.value.trim(), email: email.value.trim(), password: password.value }
    });
    if (result.status === 'pending') {
      pending.value = result.username;
    } else {
      registered.value = result.username;
    }
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}
</script>

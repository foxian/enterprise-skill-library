<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand"><h2 class="auth-title">{{ t('auth.brand') }}</h2></div>
      <el-result v-if="complete" icon="success" :title="t('passwordReset.successTitle')">
        <template #extra><router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link></template>
      </el-result>
      <el-form v-else label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('password.new')" required><el-input v-model="newPassword" type="password" show-password data-test="new-password" /></el-form-item>
        <el-form-item :label="t('password.confirm')" required><el-input v-model="confirmPassword" type="password" show-password data-test="confirm-password" /></el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
        <el-button type="primary" class="auth-submit" native-type="submit" :loading="loading" data-test="reset-password-submit">{{ t('passwordReset.submit') }}</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '../api/client';
import { formatRequestError, useLocaleState } from '../i18n/locale';

const { t } = useLocaleState();
const route = useRoute();
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const complete = ref(false);
const errorMessage = ref('');

async function submit(): Promise<void> {
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    errorMessage.value = t('passwordReset.passwordMismatch');
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    await apiRequest('/api/auth/password-reset', {
      method: 'POST',
      body: { token: String(route.query.token ?? ''), newPassword: newPassword.value }
    });
    complete.value = true;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}
</script>

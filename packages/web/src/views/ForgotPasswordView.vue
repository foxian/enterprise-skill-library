<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand"><h2 class="auth-title">{{ t('auth.brand') }}</h2></div>
      <p class="auth-subtitle">{{ t('passwordReset.requestSubtitle') }}</p>
      <el-result v-if="submitted" icon="success" :title="t('passwordReset.requestSentTitle')" :sub-title="t('passwordReset.requestSentSubtitle')">
        <template #extra><router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link></template>
      </el-result>
      <el-form v-else label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('auth.username')" required>
          <el-input v-model="username" data-test="reset-username" />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
        <el-button type="primary" class="auth-submit" native-type="submit" :loading="loading" data-test="reset-submit">
          {{ t('passwordReset.requestSubmit') }}
        </el-button>
      </el-form>
      <router-link to="/admin/login" class="auth-link">{{ t('passwordReset.backToLogin') }}</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { apiRequest } from '../api/client';
import { formatRequestError, useLocaleState } from '../i18n/locale';

const { t } = useLocaleState();
const username = ref('');
const loading = ref(false);
const submitted = ref(false);
const errorMessage = ref('');

async function submit(): Promise<void> {
  if (!username.value.trim()) {
    errorMessage.value = t('auth.usernameRequired');
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    await apiRequest('/api/auth/password-reset/request', { method: 'POST', body: { username: username.value.trim() } });
    submitted.value = true;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}
</script>

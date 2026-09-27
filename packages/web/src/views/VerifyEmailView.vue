<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand"><h2 class="auth-title">{{ t('auth.brand') }}</h2></div>
      <el-result v-if="loading" icon="info" :title="t('common.loading')" />
      <el-result
        v-else-if="errorMessage"
        icon="error"
        :title="t('verification.failedTitle')"
        :sub-title="errorMessage"
      />
      <el-result
        v-else
        icon="success"
        :title="t('verification.successTitle')"
        :sub-title="t('verification.successSubtitle', { username })"
      >
        <template #extra><router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link></template>
      </el-result>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '../api/client';
import { formatRequestError, useLocaleState } from '../i18n/locale';

const { t } = useLocaleState();
const route = useRoute();
const loading = ref(true);
const username = ref('');
const errorMessage = ref('');

onMounted(async () => {
  try {
    const token = String(route.query.token ?? '');
    const result = await apiRequest<{ username: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: { token }
    });
    username.value = result.username;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
});
</script>

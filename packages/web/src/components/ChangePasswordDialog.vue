<template>
  <el-dialog v-model="visible" :title="t('password.title')" width="420px" append-to-body @closed="reset">
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item :label="t('password.current')" required>
        <el-input
          v-model="currentPassword"
          type="password"
          show-password
          data-test="current-password"
          :placeholder="t('password.current')"
        />
      </el-form-item>
      <el-form-item :label="t('password.new')" required>
        <el-input
          v-model="newPassword"
          type="password"
          show-password
          data-test="new-password"
          :placeholder="t('password.new')"
        />
      </el-form-item>
      <el-form-item :label="t('password.confirm')" required>
        <el-input
          v-model="confirmPassword"
          type="password"
          show-password
          data-test="confirm-password"
          :placeholder="t('password.confirmPlaceholder')"
        />
      </el-form-item>
      <el-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        :closable="false"
        data-test="change-password-error"
      />
    </el-form>
    <template #footer>
      <el-button data-test="change-password-cancel" @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button
        type="primary"
        data-test="change-password-submit"
        :loading="loading"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ t('password.submit') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../api/client';
import { formatRequestError, useLocaleState } from '../i18n/locale';

const visible = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorMessage = ref('');
const { t } = useLocaleState();

const canSubmit = computed(
  () => Boolean(currentPassword.value && newPassword.value && newPassword.value === confirmPassword.value)
);

function open(): void {
  visible.value = true;
}

function reset(): void {
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  errorMessage.value = '';
}

async function submit(): Promise<void> {
  if (!canSubmit.value) {
    errorMessage.value = t('password.required');
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    // 自服务改密端点：任何已登录账号（含平台管理员）用当前密码换取改密
    await apiRequest('/api/auth/password', {
      method: 'POST',
      body: { oldPassword: currentPassword.value, newPassword: newPassword.value }
    });
    ElMessage.success(t('password.changed'));
    visible.value = false;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

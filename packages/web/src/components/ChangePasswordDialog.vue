<template>
  <el-dialog v-model="visible" title="修改密码" width="420px" append-to-body @closed="reset">
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="当前密码" required>
        <el-input
          v-model="currentPassword"
          type="password"
          show-password
          data-test="current-password"
          placeholder="当前密码"
        />
      </el-form-item>
      <el-form-item label="新密码" required>
        <el-input
          v-model="newPassword"
          type="password"
          show-password
          data-test="new-password"
          placeholder="新密码"
        />
      </el-form-item>
      <el-form-item label="确认新密码" required>
        <el-input
          v-model="confirmPassword"
          type="password"
          show-password
          data-test="confirm-password"
          placeholder="再次输入新密码"
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
      <el-button data-test="change-password-cancel" @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        data-test="change-password-submit"
        :loading="loading"
        :disabled="!canSubmit"
        @click="submit"
      >
        确认修改
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../api/client';

const visible = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorMessage = ref('');

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
    errorMessage.value = '请填写当前密码，并确保两次新密码一致';
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
    ElMessage.success('密码已修改');
    visible.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

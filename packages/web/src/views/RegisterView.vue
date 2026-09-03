<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <h2 class="auth-title">组织注册申请</h2>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="组织名" required>
          <el-input v-model="orgName" data-test="org-name" placeholder="小写字母、数字与连字符" />
          <div v-if="orgNameError" class="field-error" data-test="org-name-error">{{ orgNameError }}</div>
        </el-form-item>
        <el-form-item label="管理员账号">
          <el-input model-value="admin" disabled data-test="admin-account" />
          <div class="field-hint" data-test="admin-account-preview">
            登录账号：{{ orgName ? `${orgName}_admin` : '组织名_admin' }}
          </div>
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="password" data-test="password" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="confirmPassword" data-test="confirm-password" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="register-error" />
        <el-result
          v-if="submittedStatus"
          :icon="submittedStatus === 'approved' ? 'success' : 'info'"
          :title="submittedStatus === 'approved' ? '组织已开通' : submittedStatus === 'provisioning' ? '组织正在开通' : '申请已提交，等待审批'"
          :sub-title="submittedStatus === 'approved'
            ? '组织已初始化，请使用组织管理员账号登录。'
            : submittedStatus === 'provisioning'
              ? '组织资源正在后台初始化，完成后即可登录。'
              : '平台管理员审批通过后，组织将进入后台开通流程。'"
          data-test="register-result"
        />
        <el-button
          v-if="!submittedStatus"
          type="primary"
          class="auth-submit"
          native-type="submit"
          :loading="loading"
          data-test="register-submit"
        >
          提交申请
        </el-button>
      </el-form>
      <el-divider />
      <div class="status-lookup">
        <p class="status-lookup-title">查询申请状态</p>
        <el-input v-model="statusOrgName" data-test="status-org-name" placeholder="申请的组织名" @keyup.enter="queryStatus" />
        <el-input
          v-model="statusPassword"
          data-test="status-password"
          type="password"
          show-password
          placeholder="申请时设置的初始密码"
          class="status-lookup-password"
          @keyup.enter="queryStatus"
        />
        <el-button class="status-lookup-button" data-test="status-query" @click="queryStatus">查询</el-button>
        <div v-if="statusResult" class="status-lookup-result" data-test="status-result">{{ statusResult }}</div>
      </div>
      <router-link to="/admin/login" class="auth-link" data-test="back-to-login">返回登录</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validateOrgName } from '@esl/core/dist/org/org-name.js';
import { validatePassword } from '@esl/core/dist/org/account-policy.js';
import { apiRequest, ApiError } from '../api/client';
import { orgStatusText } from '../constants/org-status';

const orgName = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorMessage = ref('');
const submittedStatus = ref<'pending' | 'provisioning' | 'approved' | ''>('');

// 服务端固定创建 <组织名>_admin 管理员账号，申请单统一以 admin 作为管理员标识
const ADMIN_ACCOUNT = 'admin';

// 复用核心包的组织命名规则，保证前后端校验一致
const orgNameError = computed(() => {
  if (!orgName.value) {
    return '';
  }
  const validation = validateOrgName(orgName.value);
  return validation.success ? '' : validation.errors.join('；');
});

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!orgName.value || !password.value) {
    errorMessage.value = '请完整填写组织名与密码';
    return;
  }
  const validation = validateOrgName(orgName.value);
  if (!validation.success) {
    errorMessage.value = validation.errors.join('；');
    return;
  }
  const passwordValidation = validatePassword(password.value);
  if (!passwordValidation.success) {
    errorMessage.value = passwordValidation.errors.join('；');
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的密码不一致';
    return;
  }
  loading.value = true;
  try {
    const result = await apiRequest<{ status: 'pending' | 'provisioning' | 'approved' }>('/api/orgs/apply', {
      method: 'POST',
      body: {
        orgName: orgName.value,
        adminDisplayName: ADMIN_ACCOUNT,
        password: password.value
      }
    });
    submittedStatus.value = result.status;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

// 申请人自助查询:申请密文仍存在时必须提供申请时设置的初始密码,
// 且只有查看入口,没有任何重试、取消或修复入口
const statusOrgName = ref('');
const statusPassword = ref('');
const statusResult = ref('');

async function queryStatus(): Promise<void> {
  statusResult.value = '';
  if (!statusOrgName.value) {
    statusResult.value = '请输入申请的组织名';
    return;
  }
  try {
    const result = await apiRequest<{ orgName: string; status: string }>(
      `/api/orgs/applications/${encodeURIComponent(statusOrgName.value)}/status`,
      { method: 'POST', body: { password: statusPassword.value || undefined } }
    );
    statusResult.value = `组织 ${result.orgName} 的申请状态：${orgStatusText(result.status)}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      statusResult.value = '未找到该组织的申请记录';
    } else {
      statusResult.value = error instanceof Error ? error.message : String(error);
    }
  }
}
</script>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f7fa;
}

.auth-card {
  width: 400px;
}

.auth-title {
  margin: 0 0 16px;
  text-align: center;
}

.auth-submit {
  width: 100%;
}

.auth-link {
  display: block;
  margin-top: 12px;
  text-align: center;
  font-size: 13px;
}

.field-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.field-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.status-lookup-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.status-lookup-password {
  margin-top: 8px;
}

.status-lookup-button {
  margin-top: 8px;
  width: 100%;
}

.status-lookup-result {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
}
</style>

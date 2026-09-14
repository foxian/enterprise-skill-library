<template>
  <div class="auth-page">
    <el-card class="auth-card auth-card-wide">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">ESL 技能库</h2>
      </div>
      <p class="auth-subtitle">组织注册申请</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="组织名" required>
          <el-input v-model="orgName" data-test="org-name" placeholder="小写字母、数字与连字符" />
          <div v-if="orgNameError" class="field-error" data-test="org-name-error">{{ orgNameError }}</div>
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="register-error" />
        <el-result
          v-if="submitted"
          icon="info"
          title="申请已提交，等待审批"
          sub-title="平台管理员审批通过后组织即刻开通，你将成为该组织的组织管理团队成员。"
          data-test="register-result"
        />
        <el-button
          v-else
          type="primary"
          class="auth-submit"
          native-type="submit"
          :loading="loading"
          data-test="register-submit"
        >
          提交申请
        </el-button>
      </el-form>
      <router-link to="/admin/login" class="auth-link" data-test="back-to-login">返回登录</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validateOrgName } from '@esl/core/dist/org/org-name.js';
import { apiRequest } from '../api/client';

// 组织注册申请（ADR-0032）：申请人是已登录的 Skill User，批准后成为组织管理
// 团队初始成员（ADR-0033）；审批同步开通，无异步 Operation 流可订阅。
const orgName = ref('');
const loading = ref(false);
const errorMessage = ref('');
const submitted = ref(false);

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
  if (!orgName.value) {
    errorMessage.value = '请填写组织名';
    return;
  }
  const validation = validateOrgName(orgName.value);
  if (!validation.success) {
    errorMessage.value = validation.errors.join('；');
    return;
  }
  loading.value = true;
  try {
    await apiRequest('/api/orgs/applications', {
      method: 'POST',
      body: { orgName: orgName.value }
    });
    submitted.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

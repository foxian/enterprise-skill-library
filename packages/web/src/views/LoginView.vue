<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">ESL 技能库</h2>
      </div>
      <p class="auth-subtitle">管理后台登录</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" required>
          <el-input v-model="username" data-test="username" placeholder="用户名" />
        </el-form-item>
        <!-- 全局身份登录（ADR-0032）：不再输入组织，所属组织由服务端派生 -->
        <el-form-item label="密码" required>
          <el-input v-model="password" data-test="password" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="login-error" />
        <el-button type="primary" class="auth-submit" native-type="submit" :loading="loading" data-test="login-submit">
          登录
        </el-button>
      </el-form>
      <router-link v-if="!isSingleMode" to="/admin/register" class="auth-link" data-test="register-link">
        没有组织？注册组织申请
      </router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../api/client';
import { useAuthStore, type Role } from '../stores/auth';

const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
// 平台信息(ADR-0022)：单组织模式下隐藏注册入口。平台信息不可用时保持现状。
const platformInfo = ref<{ mode: 'single' | 'multi'; defaultOrg: string | null } | null>(null);
const isSingleMode = computed(() => platformInfo.value?.mode === 'single');

const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  try {
    platformInfo.value = await apiRequest('/api/public/platform-info');
  } catch {
    platformInfo.value = null;
  }
});

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名与密码';
    return;
  }
  const trimmedUsername = username.value.trim();
  loading.value = true;
  try {
    // 全局身份登录（ADR-0032）：username + password 一条凭据；组织列表与
    // 角色由服务端按 Gitea 成员关系派生，前端不做推导。
    const result = await apiRequest<{
      token: string;
      username: string;
      role: Role;
      organizations?: Array<{ org: string; role: 'org-admin' | 'member' }>;
    }>('/api/console/login', {
      method: 'POST',
      body: { username: trimmedUsername, password: password.value }
    });
    const organizations = result.organizations ?? [];
    const org = organizations.find((membership) => membership.role === 'org-admin')?.org ?? organizations[0]?.org ?? null;
    auth.establish({
      token: result.token,
      username: result.username,
      org,
      role: result.role,
      organizations
    });
    await router.push(auth.homePath);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

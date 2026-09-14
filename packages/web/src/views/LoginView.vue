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
      <router-link to="/admin/register-user" class="auth-link" data-test="user-register-link">
        没有账号？注册个人账号
      </router-link>
      <router-link to="/admin/register" class="auth-link" data-test="register-link">
        没有组织？注册组织申请
      </router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../api/client';
import { useAuthStore, type SessionOrganization } from '../stores/auth';

const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');

const router = useRouter();
const auth = useAuthStore();

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名与密码';
    return;
  }
  const trimmedUsername = username.value.trim();
  loading.value = true;
  try {
    // 全局身份登录（ADR-0032）：username + password 一条凭据。服务端只回两件
    // 事实——是不是平台管理员、在每个组织是不是组织管理团队成员（ADR-0033），
    // 前端不推导角色，也不挑"当前组织"（组织由路由显式指名，ADR-0035）。
    const result = await apiRequest<{
      token: string;
      username: string;
      isPlatformAdmin: boolean;
      organizations?: SessionOrganization[];
    }>('/api/console/login', {
      method: 'POST',
      body: { username: trimmedUsername, password: password.value }
    });
    auth.establish({
      token: result.token,
      username: result.username,
      isPlatformAdmin: result.isPlatformAdmin,
      organizations: result.organizations ?? []
    });
    await router.push(auth.homePath);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

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
        <!-- 单组织模式下仅默认组织可登录,隐藏组织输入框;多组织模式即使设了默认
             组织也保留输入框(默认组织只是留空时的解析目标,其他组织用户仍需填写)。 -->
        <el-form-item v-if="!isSingleMode" label="组织名（超级管理员留空）">
          <el-input v-model="org" data-test="org" placeholder="组织名，可留空" />
        </el-form-item>
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
const org = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
// 平台信息(ADR-0022):设有默认组织时隐藏组织输入框,单组织模式下隐藏注册入口。
// 平台信息不可用时保持现状(展示组织输入框),不让登录被非必要请求阻断。
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
  const trimmedOrg = org.value.trim();
  loading.value = true;
  try {
    // 管理后台专用登录端点：组织账号由服务端解析 <org>_<username> 并校验归属，
    // 无组织的平台管理员由服务端判定为 super；角色一律以服务端返回为准。
    const result = await apiRequest<{ token: string; username: string; org: string | null; role: Role }>(
      '/api/console/login',
      {
        method: 'POST',
        body: { username: trimmedUsername, org: trimmedOrg || null, password: password.value }
      }
    );
    auth.establish({
      token: result.token,
      username: result.username,
      org: result.org,
      role: result.role
    });
    await router.push(auth.homePath);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

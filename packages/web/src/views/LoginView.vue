<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <h2 class="auth-title">ESL 技能库管理后台</h2>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" required>
          <el-input v-model="username" data-test="username" placeholder="用户名" />
        </el-form-item>
        <el-form-item label="组织名（超级管理员留空）">
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
import { useAuthStore, type Role } from '../stores/auth';

const username = ref('');
const org = ref('');
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

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f7fa;
}

.auth-card {
  width: 380px;
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
</style>

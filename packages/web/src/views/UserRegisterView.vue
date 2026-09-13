<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">注册 ESL 账号</h2>
      </div>
      <p class="auth-subtitle">注册即拥有个人命名空间 @用户名</p>

      <el-result
        v-if="pending"
        data-test="register-pending"
        icon="warning"
        title="注册已提交，等待管理员审批"
        :sub-title="`账号 ${pending} 创建后需平台管理员批准后方可登录。`"
      />
      <el-result
        v-else-if="registered"
        data-test="register-success"
        icon="success"
        title="注册成功"
        :sub-title="`账号 ${registered} 已可登录，个人命名空间 @${registered} 已就绪。`"
      >
        <template #extra>
          <router-link to="/admin/login" class="auth-link">前往登录</router-link>
        </template>
      </el-result>

      <el-form v-else label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" required>
          <el-input v-model="username" data-test="register-username" placeholder="小写字母、数字、连字符" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="password" data-test="register-password" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="confirmPassword" data-test="register-confirm" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="register-error" />
        <el-button
          type="primary"
          class="auth-submit"
          native-type="submit"
          :loading="loading"
          data-test="register-submit"
        >
          注册
        </el-button>
      </el-form>
      <router-link to="/admin/login" class="auth-link" data-test="login-link">已有账号？去登录</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiRequest } from '../api/client';

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorMessage = ref('');
const registered = ref('');
const pending = ref('');

onMounted(() => {
  // 注册模式只影响服务端行为（open 直接建号 / approval 建号后待审），
  // 前端不按模式改表单，按响应状态展示结果。
});

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名与密码';
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的密码不一致';
    return;
  }
  loading.value = true;
  try {
    const result = await apiRequest<{ status: string; username: string }>('/api/auth/register', {
      method: 'POST',
      body: { username: username.value.trim(), password: password.value }
    });
    if (result.status === 'pending') {
      pending.value = result.username;
    } else {
      registered.value = result.username;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">{{ t('auth.brand') }}</h2>
      </div>
      <p class="auth-subtitle">{{ t('auth.adminSignIn') }}</p>
      <LocaleSwitch class="auth-locale-switch" />
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('auth.username')" required>
          <el-input v-model="username" data-test="username" :placeholder="t('auth.username')" />
        </el-form-item>
        <!-- 全局身份登录（ADR-0032）：不再输入组织，所属组织由服务端派生 -->
        <el-form-item :label="t('auth.password')" required>
          <el-input v-model="password" data-test="password" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="login-error" />
        <el-button type="primary" class="auth-submit" native-type="submit" :loading="loading" data-test="login-submit">
          {{ t('auth.login') }}
        </el-button>
      </el-form>
      <!-- 登录页只留账号注册：组织不属于登录前的上下文。组织申请是已登录
           Skill User 在个人控制台「我的组织」里做的事（ADR-0032/0035）——
          `POST /api/orgs/applications` 需要 token，匿名访客点进来必然 401。 -->
      <router-link to="/admin/register-user" class="auth-link" data-test="user-register-link">
        {{ t('auth.registerLink') }}
      </router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../api/client';
import { formatRequestError, useLocaleState } from '../i18n/locale';
import LocaleSwitch from '../components/LocaleSwitch.vue';
import { useAuthStore, type SessionOrganization } from '../stores/auth';

const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');

const router = useRouter();
const auth = useAuthStore();
const { t } = useLocaleState();

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!username.value.trim() || !password.value) {
    errorMessage.value = t('auth.credentialsRequired');
    return;
  }
  const trimmedUsername = username.value.trim();
  loading.value = true;
  try {
    // 全局身份登录（ADR-0032）：username + password 一条凭据。服务端只回两件
    // 事实——是不是平台管理员、在每个组织是不是所有者成员（ADR-0033），
    // 前端不推导角色，也不挑"当前组织"（组织由路由显式指名，ADR-0035）。
    const result = await apiRequest<{
      token: string;
      username: string;
      isPlatformAdmin: boolean;
      organizations?: SessionOrganization[];
      locale?: string | null;
    }>('/api/console/login', {
      method: 'POST',
      body: { username: trimmedUsername, password: password.value }
    });
    auth.establish({
      token: result.token,
      username: result.username,
      isPlatformAdmin: result.isPlatformAdmin,
      organizations: result.organizations ?? [],
      locale: result.locale ?? null
    });
    await router.push(auth.homePath);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}
</script>

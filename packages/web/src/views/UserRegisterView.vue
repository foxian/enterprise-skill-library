<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-mark" aria-hidden="true"></span>
        <h2 class="auth-title">{{ t('registration.title') }}</h2>
      </div>
      <p class="auth-subtitle">{{ t('registration.subtitle') }}</p>
      <LocaleSwitch class="auth-locale-switch" />

      <el-result
        v-if="pending"
        data-test="register-pending"
        icon="warning"
        :title="t('registration.pendingTitle')"
        :sub-title="t('registration.pendingSubtitle', { username: pending })"
      />
      <el-result
        v-else-if="pendingEmailVerification"
        data-test="register-email-pending"
        icon="info"
        :title="t('registration.emailVerificationPendingTitle')"
        :sub-title="t('registration.emailVerificationPendingSubtitle', pendingEmailVerification)"
      >
        <template #extra>
          <el-button :loading="resending" data-test="resend-verification" @click="resendVerification">
            {{ t('registration.resendVerification') }}
          </el-button>
          <router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link>
        </template>
      </el-result>
      <el-result
        v-else-if="registered"
        data-test="register-success"
        icon="success"
        :title="t('registration.successTitle')"
        :sub-title="t('registration.successSubtitle', { username: registered })"
      >
        <template #extra>
          <router-link to="/admin/login" class="auth-link">{{ t('registration.goToLogin') }}</router-link>
        </template>
      </el-result>

      <el-form v-else label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('registration.username')" required :error="fieldErrors.username">
          <el-input v-model="form.username" data-test="register-username" :placeholder="t('registration.usernamePlaceholder')" />
          <div class="auth-field-hint" data-test="register-username-hint">{{ usernameHint }}</div>
        </el-form-item>
        <el-form-item :label="t('registration.email')" required :error="fieldErrors.email">
          <el-input v-model="form.email" data-test="register-email" :placeholder="t('registration.emailPlaceholder')" />
          <div class="auth-field-hint" data-test="register-email-hint">{{ emailHint }}</div>
        </el-form-item>
        <el-form-item :label="t('registration.password')" required :error="fieldErrors.password">
          <el-input v-model="form.password" data-test="register-password" type="password" show-password />
          <div class="auth-field-hint" data-test="register-password-hint">{{ passwordHint }}</div>
        </el-form-item>
        <el-form-item :label="t('registration.confirmPassword')" required :error="fieldErrors.confirmPassword">
          <el-input v-model="form.confirmPassword" data-test="register-confirm" type="password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" data-test="register-error" />
        <el-button
          type="primary"
          class="auth-submit"
          native-type="submit"
          :loading="loading"
          data-test="register-submit"
        >
          {{ t('registration.submit') }}
        </el-button>
      </el-form>
      <router-link to="/admin/login" class="auth-link" data-test="login-link">{{ t('registration.existingAccount') }}</router-link>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { apiErrorMessages, translateApiError } from '@esl/i18n';
// 深层引入纯规则模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import {
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_NAME_MIN_LENGTH,
  DEFAULT_PASSWORD_MIN_LENGTH,
  validateMemberUsername,
  validatePassword,
  validateSkillUserEmail
} from '@esl/core/dist/org/account-policy.js';
import { apiRequest } from '../api/client';
import { useLocaleState } from '../i18n/locale';
import LocaleSwitch from '../components/LocaleSwitch.vue';
import { formatRequestError } from '../i18n/locale';

const form = reactive({ username: '', email: '', password: '', confirmPassword: '' });
const fieldErrors = reactive({ username: '', email: '', password: '', confirmPassword: '' });
const loading = ref(false);
const errorMessage = ref('');
const registered = ref('');
const pending = ref('');
const pendingEmailVerification = ref<{ username: string; email: string } | null>(null);
const resending = ref(false);
// 密码最小长度以服务端生效值为准（#146）：拉取失败时回退到共享默认值。
const passwordMinLength = ref(DEFAULT_PASSWORD_MIN_LENGTH);
const { t, current } = useLocaleState();

// 本地预校验直接复用契约层的账号规则（#146），错误码与 API 错误共用同一套文案
// （#145）：命中同一个 code 时，服务端响应与前端字段提示显示同一句话。
function policyMessage(code: string, params?: Record<string, string>): string {
  return translateApiError({
    locale: current.value,
    code,
    params,
    fallback: apiErrorMessages[code as keyof typeof apiErrorMessages] ?? code
  });
}

const usernameHint = computed(() =>
  t('registration.usernameHint', { min: ACCOUNT_NAME_MIN_LENGTH, max: ACCOUNT_NAME_MAX_LENGTH })
);
const emailHint = computed(() => t('registration.emailHint'));
const passwordHint = computed(() => t('registration.passwordHint', { min: passwordMinLength.value }));

// 用与后端相同的规则做本地预校验，格式错误直接阻止提交并显示字段级错误，
// 无需一次网络往返（#146）。
function validateLocally(): boolean {
  fieldErrors.username = '';
  fieldErrors.email = '';
  fieldErrors.password = '';
  fieldErrors.confirmPassword = '';

  if (!form.username.trim()) {
    fieldErrors.username = t('registration.usernameRequired');
  } else {
    const result = validateMemberUsername(form.username.trim());
    if (!result.success) fieldErrors.username = policyMessage(result.errors[0]);
  }

  if (!form.email.trim()) {
    fieldErrors.email = t('registration.emailRequired');
  } else {
    const result = validateSkillUserEmail(form.email);
    if (!result.success) fieldErrors.email = policyMessage(result.errors[0]);
  }

  if (!form.password) {
    fieldErrors.password = t('registration.passwordRequired');
  } else {
    const result = validatePassword(form.password, passwordMinLength.value);
    if (!result.success) {
      fieldErrors.password = policyMessage(result.errors[0], {
        min: String(passwordMinLength.value)
      });
    }
  }

  if (form.confirmPassword !== form.password) {
    fieldErrors.confirmPassword = t('registration.passwordsDoNotMatch');
  }

  return !Object.values(fieldErrors).some(Boolean);
}

onMounted(async () => {
  // 注册模式只影响服务端行为（open 直接建号 / approval 建号后待审），前端不按
  // 模式改表单，按响应状态展示结果；但密码最小长度按平台配置展示与预校验。
  try {
    const info = await apiRequest<{ passwordMinLength?: number }>('/api/public/platform-info');
    if (typeof info.passwordMinLength === 'number' && info.passwordMinLength > 0) {
      passwordMinLength.value = info.passwordMinLength;
    }
  } catch {
    // 平台信息拉取失败不阻断注册；沿用共享默认值。
  }
});

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!validateLocally()) return;
  loading.value = true;
  try {
    const result = await apiRequest<{ status: string; username: string }>('/api/auth/register', {
      method: 'POST',
      body: { username: form.username.trim(), email: form.email.trim(), password: form.password }
    });
    if (result.status === 'pending_email_verification') {
      pendingEmailVerification.value = {
        username: result.username,
        email: form.email.trim()
      };
    } else if (result.status === 'pending') {
      pending.value = result.username;
    } else {
      registered.value = result.username;
    }
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

async function resendVerification(): Promise<void> {
  if (!pendingEmailVerification.value) return;
  resending.value = true;
  errorMessage.value = '';
  try {
    await apiRequest('/api/auth/verify-email/resend', {
      method: 'POST',
      body: { username: pendingEmailVerification.value.username, purpose: 'register' }
    });
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    resending.value = false;
  }
}
</script>

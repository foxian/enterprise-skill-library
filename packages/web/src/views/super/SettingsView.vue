<template>
  <div>
    <h2>平台设置</h2>
    <el-card>
      <el-form label-width="160px">
        <el-form-item label="组织注册审批模式">
          <el-radio-group v-model="orgRegistrationMode" data-test="registration-mode">
            <el-radio value="auto">免审批（自动开通）</el-radio>
            <el-radio value="manual">需要审批</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            data-test="save-settings"
            :loading="saving"
            :disabled="orgRegistrationMode === savedMode"
            @click="save"
          >
            保存
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
    </el-card>
    <el-card style="margin-top: 16px">
      <template #header>管理员账号密码</template>
      <el-form label-width="160px" @submit.prevent="changeAdminPassword">
        <el-form-item label="新密码">
          <el-input
            v-model="adminPassword"
            type="password"
            show-password
            data-test="admin-password"
            placeholder="新密码"
          />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input
            v-model="adminPasswordConfirm"
            type="password"
            show-password
            data-test="admin-password-confirm"
            placeholder="再次输入新密码"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            data-test="change-admin-password"
            :loading="changingPassword"
            :disabled="!adminPassword || adminPassword !== adminPasswordConfirm"
            @click="changeAdminPassword"
          >
            修改密码
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="passwordError" type="error" :title="passwordError" :closable="false" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

const orgRegistrationMode = ref<'auto' | 'manual'>('auto');
const savedMode = ref<'auto' | 'manual'>('auto');
const saving = ref(false);
const errorMessage = ref('');
const adminPassword = ref('');
const adminPasswordConfirm = ref('');
const changingPassword = ref(false);
const passwordError = ref('');

async function load(): Promise<void> {
  errorMessage.value = '';
  try {
    const settings = await apiRequest<{ orgRegistrationMode: 'auto' | 'manual' }>('/api/admin/orgs/settings');
    orgRegistrationMode.value = settings.orgRegistrationMode;
    savedMode.value = settings.orgRegistrationMode;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function save(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    const settings = await apiRequest<{ orgRegistrationMode: 'auto' | 'manual' }>('/api/admin/orgs/settings', {
      method: 'PUT',
      body: { orgRegistrationMode: orgRegistrationMode.value }
    });
    savedMode.value = settings.orgRegistrationMode;
    orgRegistrationMode.value = settings.orgRegistrationMode;
    ElMessage.success('平台设置已保存');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function changeAdminPassword(): Promise<void> {
  if (!adminPassword.value || adminPassword.value !== adminPasswordConfirm.value) {
    passwordError.value = '两次输入的密码不一致';
    return;
  }
  changingPassword.value = true;
  passwordError.value = '';
  try {
    await apiRequest('/api/admin/account/password', {
      method: 'POST',
      body: { password: adminPassword.value }
    });
    adminPassword.value = '';
    adminPasswordConfirm.value = '';
    ElMessage.success('管理员密码已修改');
  } catch (error) {
    passwordError.value = error instanceof Error ? error.message : String(error);
  } finally {
    changingPassword.value = false;
  }
}

onMounted(load);
</script>

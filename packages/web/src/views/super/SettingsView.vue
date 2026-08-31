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

onMounted(load);
</script>

<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-form label-width="160px">
        <el-form-item label="组织注册审批模式">
          <el-radio-group v-model="orgRegistrationMode" data-test="registration-mode">
            <el-radio value="auto">免审批（自动开通）</el-radio>
            <el-radio value="manual">需要审批</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="部署模式">
          <el-radio-group v-model="deploymentMode" data-test="deployment-mode">
            <el-radio value="multi">多组织</el-radio>
            <el-radio value="single">单组织</el-radio>
          </el-radio-group>
          <div class="form-hint">
            多组织模式支持多个独立组织，登录时需选择组织；
            单组织模式仅默认组织可用，登录时无需指定组织。
          </div>
        </el-form-item>
        <el-form-item label="默认组织" :required="deploymentMode === 'single'">
          <el-select
            v-model="defaultOrg"
            :placeholder="deploymentMode === 'single' ? '请选择默认组织' : '多组织模式下可选'"
            :clearable="deploymentMode === 'multi'"
            :disabled="orgsLoading || activeOrgs.length === 0"
            style="width: 280px"
            data-test="default-org-select"
          >
            <el-option
              v-for="org in activeOrgs"
              :key="org.name"
              :label="org.name"
              :value="org.name"
            />
            <template v-if="activeOrgs.length === 0 && !orgsLoading" #empty>
              暂无可用组织
            </template>
          </el-select>
          <div class="form-hint">
            登录时省略组织名将默认解析到该组织。
            单组织模式下该组织是唯一可登录的组织。
          </div>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            data-test="save-settings"
            :loading="saving"
            :disabled="!hasChanges || hasValidationError"
            @click="handleSave"
          >
            保存
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
    </el-card>

    <el-dialog
      v-model="confirmDialogVisible"
      title="更换默认组织确认"
      width="420px"
      :close-on-click-modal="false"
      data-test="confirm-default-org-dialog"
    >
      <p>
        即将将默认组织从 <strong>{{ savedDefaultOrg }}</strong>
        更换为 <strong>{{ defaultOrg }}</strong>。
      </p>
      <p>原组织成员将立即无法登录，操作影响范围较大。</p>
      <p>请输入新的默认组织名 <code>{{ defaultOrg }}</code> 以确认：</p>
      <el-input
        v-model="confirmInput"
        placeholder="请输入组织名确认"
        data-test="confirm-default-org-input"
      />
      <template #footer>
        <el-button @click="confirmDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="saving"
          :disabled="confirmInput !== defaultOrg"
          data-test="confirm-default-org-button"
          @click="doSave"
        >
          确认更换
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  status: string | null;
}

type RegistrationMode = 'auto' | 'manual';
type DeploymentMode = 'single' | 'multi';

const orgRegistrationMode = ref<RegistrationMode>('auto');
const savedRegistrationMode = ref<RegistrationMode>('auto');
const deploymentMode = ref<DeploymentMode>('multi');
const savedDeploymentMode = ref<DeploymentMode>('multi');
const defaultOrg = ref('');
const savedDefaultOrg = ref('');
const orgs = ref<OrgSummary[]>([]);
const orgsLoading = ref(false);
const settingsLoading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const confirmDialogVisible = ref(false);
const confirmInput = ref('');

const activeOrgs = computed(() => orgs.value.filter((org) => org.status === 'active'));

const hasChanges = computed(() => {
  return (
    orgRegistrationMode.value !== savedRegistrationMode.value ||
    deploymentMode.value !== savedDeploymentMode.value ||
    defaultOrg.value !== savedDefaultOrg.value
  );
});

const hasValidationError = computed(() => {
  return deploymentMode.value === 'single' && !defaultOrg.value;
});

// 单组织模式内更换默认组织需要确认（与后端校验逻辑对齐）：
// 当前已保存为 single、表单仍为 single、且 defaultOrg 发生变化。
// 从 multi 切到 single 的原子切换不需要 confirm。
const needsConfirm = computed(() => {
  return (
    savedDeploymentMode.value === 'single' &&
    deploymentMode.value === 'single' &&
    savedDefaultOrg.value !== '' &&
    defaultOrg.value !== '' &&
    defaultOrg.value !== savedDefaultOrg.value
  );
});

async function load(): Promise<void> {
  errorMessage.value = '';
  settingsLoading.value = true;
  orgsLoading.value = true;
  try {
    const [settings, orgList] = await Promise.all([
      apiRequest<{
        orgRegistrationMode: RegistrationMode;
        deploymentMode: DeploymentMode;
        defaultOrg: string | null;
      }>('/api/admin/orgs/settings'),
      apiRequest<OrgSummary[]>('/api/admin/orgs'),
    ]);
    orgRegistrationMode.value = settings.orgRegistrationMode;
    savedRegistrationMode.value = settings.orgRegistrationMode;
    deploymentMode.value = settings.deploymentMode;
    savedDeploymentMode.value = settings.deploymentMode;
    defaultOrg.value = settings.defaultOrg ?? '';
    savedDefaultOrg.value = settings.defaultOrg ?? '';
    orgs.value = orgList;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    settingsLoading.value = false;
    orgsLoading.value = false;
  }
}

function handleSave(): void {
  if (deploymentMode.value === 'single' && !defaultOrg.value) {
    errorMessage.value = '单组织模式必须选择默认组织';
    return;
  }
  if (needsConfirm.value) {
    confirmInput.value = '';
    confirmDialogVisible.value = true;
    return;
  }
  doSave();
}

async function doSave(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    const body: Record<string, unknown> = {
      orgRegistrationMode: orgRegistrationMode.value,
      deploymentMode: deploymentMode.value,
      defaultOrg: defaultOrg.value || null,
    };
    if (needsConfirm.value) {
      body.confirm = defaultOrg.value;
    }
    const settings = await apiRequest<{
      orgRegistrationMode: RegistrationMode;
      deploymentMode: DeploymentMode;
      defaultOrg: string | null;
    }>('/api/admin/orgs/settings', {
      method: 'PUT',
      body,
    });
    savedRegistrationMode.value = settings.orgRegistrationMode;
    savedDeploymentMode.value = settings.deploymentMode;
    savedDefaultOrg.value = settings.defaultOrg ?? '';
    orgRegistrationMode.value = settings.orgRegistrationMode;
    deploymentMode.value = settings.deploymentMode;
    defaultOrg.value = settings.defaultOrg ?? '';
    confirmDialogVisible.value = false;
    ElMessage.success('平台设置已保存');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}

code {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}
</style>

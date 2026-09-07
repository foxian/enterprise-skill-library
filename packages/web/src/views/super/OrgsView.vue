<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">共 {{ orgs.length }} 个组织</span>
        <div>
          <el-button type="primary" data-test="open-add-org" @click="openAddOrgDialog">
            开通组织
          </el-button>
        </div>
      </div>

      <el-table :data="orgs" data-test="orgs-table" v-loading="loading">
        <el-table-column prop="name" label="组织名" />
        <el-table-column label="生命周期" width="120">
          <template #default="{ row }">
            <el-tag :type="orgStatusTagType(row.status)" :data-test="`org-status-${row.name}`">
              {{ orgStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="memberCount" label="成员数" width="100" />
        <el-table-column prop="skillCount" label="技能数" width="100" />
        <el-table-column label="创建时间" width="200">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button link type="primary" :data-test="`org-detail-${row.name}`" @click="openDetail(row.name)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />

    <!-- 开通组织对话框 -->
    <el-dialog v-model="addDialogVisible" title="开通组织" width="420px" :close-on-click-modal="false" :close-on-press-escape="!provisioning">
      <el-form label-width="100px">
        <el-form-item label="组织名" required>
          <el-input
            v-model="addOrgName"
            data-test="add-org-name"
            :disabled="provisioning"
            placeholder="小写字母、数字与连字符，2-39 字符"
          />
        </el-form-item>
        <el-form-item label="组织管理员">
          <el-input
            :model-value="orgAdminUsername"
            readonly
            data-test="add-org-admin-username"
            :disabled="provisioning"
            placeholder="由组织名自动生成"
          />
          <div class="form-hint">由组织名自动生成，用于组织管理员登录。</div>
        </el-form-item>
        <el-form-item label="初始密码">
          <el-input
            v-model="addPassword"
            data-test="add-org-password"
            :disabled="provisioning"
            placeholder="留空自动生成"
            show-password
          />
          <div class="form-hint">组织管理员的初始密码。</div>
        </el-form-item>
        <el-alert v-if="provisioning" type="info" title="正在开通组织，请稍候..." :closable="false" />
        <el-alert v-if="provisioningError" type="error" :title="provisioningError" :closable="false" />
      </el-form>
      <template #footer>
        <el-button :disabled="provisioning" @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="provisioning" data-test="add-org-submit" @click="addOrg">
          {{ provisioning ? '开通中...' : '开通' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 一次性初始密码展示：关闭后不再可见 -->
    <el-dialog v-model="passwordDialogVisible" title="组织开通" width="420px">
      <p>组织 <strong>{{ passwordDialogOrgName }}</strong> 已进入开通流程。</p>
      <p>组织管理员初始密码（仅展示一次，请立即保存）：</p>
      <el-input :model-value="oneTimePassword" readonly data-test="one-time-password" show-password />
      <p class="form-hint">管理员用户名为 <code>{{ passwordDialogOrgName }}_admin</code>。</p>
      <template #footer>
        <el-button type="primary" data-test="one-time-password-close" @click="passwordDialogVisible = false">
          我已保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validatePassword } from '@esl/core/dist/org/account-policy.js';
import { validateOrgName } from '@esl/core/dist/org/org-name.js';
import { apiRequest, openOperationStream, type OperationStream } from '../../api/client';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
  status?: string | null;
  lastError?: { code: string; message: string; details: Record<string, unknown> } | null;
  operationId?: number | null;
}

const orgs = ref<OrgSummary[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const router = useRouter();

const addDialogVisible = ref(false);
const addOrgName = ref('');
const addPassword = ref('');
// 等待开通期间为 true:锁定表单、按钮转圈,成功或失败后解除
const provisioning = ref(false);
const provisioningError = ref('');

const passwordDialogVisible = ref(false);
const passwordDialogOrgName = ref('');
const oneTimePassword = ref('');

// 组织管理员账号由组织名自动拼装(与后端 org-init 的 `${orgName}_admin` 约定一致)
const orgAdminUsername = computed(() =>
  addOrgName.value ? `${addOrgName.value}_admin` : ''
);

// 组织开通是异步 Operation:订阅状态流,开通完成后再刷新列表
let operationStream: OperationStream | undefined;

onUnmounted(() => {
  operationStream?.close();
  operationStream = undefined;
});

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function openDetail(name: string): void {
  void router.push({ name: 'super-org-detail', params: { orgName: name } });
}

function openAddOrgDialog(): void {
  addOrgName.value = '';
  addPassword.value = '';
  errorMessage.value = '';
  provisioningError.value = '';
  addDialogVisible.value = true;
}

async function loadOrgs(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    orgs.value = await apiRequest<OrgSummary[]>('/api/admin/orgs');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function addOrg(): Promise<void> {
  errorMessage.value = '';
  provisioningError.value = '';

  const nameValidation = validateOrgName(addOrgName.value);
  if (!nameValidation.success) {
    errorMessage.value = nameValidation.errors.join('；');
    return;
  }

  if (addPassword.value) {
    const passwordValidation = validatePassword(addPassword.value);
    if (!passwordValidation.success) {
      errorMessage.value = passwordValidation.errors.join('；');
      return;
    }
  }

  provisioning.value = true;
  try {
    const result = await apiRequest<{
      status: string;
      orgName: string;
      operationId: number;
      initialPassword: string;
    }>('/api/admin/orgs', {
      method: 'POST',
      body: {
        orgName: addOrgName.value,
        password: addPassword.value || undefined,
      },
    });

    // 对话框保持打开,等待后端完全激活(succeeded)后才关闭并展示密码。
    operationStream?.close();
    operationStream = openOperationStream(result.operationId, {
      onEvent: (event) => {
        if (event.status === 'succeeded') {
          provisioning.value = false;
          addDialogVisible.value = false;
          addOrgName.value = '';
          addPassword.value = '';
          // 激活成功后展示一次性初始密码,组织此时才真实可用
          passwordDialogOrgName.value = result.orgName;
          oneTimePassword.value = result.initialPassword;
          passwordDialogVisible.value = true;
          ElMessage.success(`组织 ${result.orgName} 已开通`);
          void loadOrgs();
        } else if (event.status === 'permanently_failed') {
          provisioning.value = false;
          provisioningError.value = '组织开通失败，请检查后重新提交';
          void loadOrgs();
        }
      },
      onError: () => {
        // 流断开(如网络抖动)时无法确定开通结果,解锁表单让用户可刷新或重试
        provisioning.value = false;
        provisioningError.value = '开通状态连接中断，请稍后点击重新开通或刷新列表查看结果';
      },
    });
  } catch (error) {
    provisioning.value = false;
    provisioningError.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(() => {
  void loadOrgs();
});
</script>

<style scoped>
.console-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.toolbar-caption {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

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

.page-error {
  margin-top: 16px;
}
</style>

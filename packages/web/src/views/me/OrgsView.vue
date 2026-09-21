<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">{{ t('organization.myOrganizations') }}</span>
        <div class="toolbar-end">
          <el-button type="primary" data-test="create-org" @click="openCreateDialog">{{ t('organization.createOrganization') }}</el-button>
        </div>
      </div>

      <el-table v-if="rows.length > 0" :data="rows" data-test="my-orgs-table" v-loading="loading">
        <el-table-column :label="t('columns.organization')" min-width="180">
          <template #default="{ row }">@{{ row.org }}</template>
        </el-table-column>
        <el-table-column :label="t('columns.status')" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" :data-test="`org-status-${row.status}`">
              {{ t(statusText(row.status)) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.myIdentity')" width="180">
          <template #default="{ row }">
            <!-- 待审申请还没产生组织，此时没有任何身份（ADR-0038） -->
            <el-tag v-if="row.identity" :type="identityTagType(row.identity)" :data-test="`org-identity-${row.identity}`">
              {{ t(identityLabel(row.identity)) }}
            </el-tag>
            <span v-else data-test="org-identity-none">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="180">
          <template #default="{ row }">
            <!-- 运营入口对管理成员与所有者成员开放；其余成员看到只读技能入口。 -->
            <el-button
              v-if="row.identity === 'owner' && (row.status === 'delete_failed' || row.status === 'deleting')"
              link
              type="primary"
              :data-test="`manage-${row.org}`"
              @click="openOrg(row.org)"
            >
              {{ row.status === 'delete_failed' ? t('actions.retryDelete') : t('actions.viewProgress') }}
            </el-button>
            <el-button
              v-else-if="(row.identity === 'managing' || row.identity === 'owner') && row.status === 'active'"
              link
              type="primary"
              :data-test="`manage-${row.org}`"
              @click="openOrg(row.org)"
            >
              {{ t('actions.manage') }}
            </el-button>
            <el-button
              v-else-if="row.status === 'active'"
              link
              type="primary"
              :data-test="`browse-${row.org}`"
              @click="browseOrgSkills(row.org)"
            >
              {{ t('actions.viewSkills') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && rows.length === 0" :description="t('organization.noOrganizations')" />
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="createDialogVisible" :title="manualMode ? t('organization.applyCreateOrganization') : t('organization.createOrganization')" width="460px">
      <p class="create-hint">
        {{
          manualMode
            ? t('organization.approvalCreationHint')
            : t('organization.manualCreationHint')
        }}
      </p>
      <el-form label-width="90px">
        <el-form-item :label="t('columns.organizationName')" required>
          <el-input v-model="newOrgName" data-test="create-org-name" :placeholder="t('organization.orgNamePlaceholder')" />
          <div v-if="newOrgNameError" class="field-error" data-test="create-org-name-error">{{ newOrgNameError }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" data-test="create-org-submit" @click="submitCreate">
          {{ manualMode ? t('actions.submit') : t('actions.create') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validateOrgName } from '@esl/core/dist/org/org-name.js';
import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType } from '../../constants/org-identity';
import { useAuthStore } from '../../stores/auth';

const { t } = useLocaleState();

interface OrganizationRow {
  org: string;
  /** 我在该组织的身份；待审申请尚未产生组织，此时为 null（ADR-0038）。 */
  identity: OrgIdentity | null;
  isOwnerMember: boolean;
  /** 组织生命周期状态（ADR-0034）：active / pending / deleting / delete_failed … */
  status: string;
}

interface MyOrgsResponse {
  organizations: Array<{ org: string; identity: OrgIdentity; isOwnerMember: boolean; status: string }>;
  pendingApplications: Array<{ orgName: string; submittedAt: string }>;
}

// deleting / delete_failed 是需要被治理者看见的状态：组织不能悄悄消失，
// 删除失败也不是死局——列表上带状态、可回到组织详情重试（ADR-0034）。
const STATUS_LABELS: Record<string, string> = {
  active: 'status.active',
  pending: 'status.pending',
  deleting: 'status.deleting',
  delete_failed: 'status.deleteFailed',
  deleted: 'status.deleted'
};

function statusText(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'delete_failed') return 'danger';
  if (status === 'deleted') return 'info';
  return 'warning';
}

const router = useRouter();
const auth = useAuthStore();

const response = ref<MyOrgsResponse | null>(null);
const loading = ref(false);
const errorMessage = ref('');

const createDialogVisible = ref(false);
const newOrgName = ref('');
const manualMode = ref(false);

// 复用核心包的组织命名规则，前后端校验一致（服务端仍独立校验，前端只为即时反馈）
const newOrgNameError = computed(() => {
  const orgName = newOrgName.value.trim();
  if (!orgName) {
    return '';
  }
  const validation = validateOrgName(orgName);
  return validation.success ? '' : validation.errors.join('；');
});

// 待审申请尚未产生组织，但它属于"我的组织"列表要呈现的状态（ADR-0035）。
const rows = computed<OrganizationRow[]>(() => {
  const memberships: OrganizationRow[] = response.value?.organizations ?? [];
  const pending: OrganizationRow[] = (response.value?.pendingApplications ?? []).map((application) => ({
    org: application.orgName,
    identity: null,
    isOwnerMember: false,
    status: 'pending'
  }));
  return [...memberships, ...pending].sort((a, b) => a.org.localeCompare(b.org));
});

async function loadOrgs(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    response.value = await apiRequest<MyOrgsResponse>('/api/orgs/mine');
    // 会话里的组织列表与本页同源；一并刷新，菜单与守卫看到的状态跟着更新。
    // 会话只存身份与治理权，生命周期状态只用于本页展示。
    auth.establish({
      ...auth.session!,
      organizations: response.value.organizations.map(({ org, identity, isOwnerMember }) => ({
        org,
        identity,
        isOwnerMember
      }))
    });
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

function openCreateDialog(): void {
  newOrgName.value = '';
  createDialogVisible.value = true;
}

function openOrg(org: string): void {
  void router.push({ name: 'me-org-members', params: { org } });
}

function browseOrgSkills(org: string): void {
  void router.push({ name: 'me-skills', query: { namespace: org } });
}

async function submitCreate(): Promise<void> {
  errorMessage.value = '';
  const orgName = newOrgName.value.trim();
  if (!orgName) {
    errorMessage.value = t('organization.enterOrgName');
    return;
  }
  // 命名不合规由 newOrgNameError 就地提示（随输入实时显示），这里只负责不发请求
  if (!validateOrgName(orgName).success) {
    return;
  }
  try {
    if (manualMode.value) {
      await apiRequest('/api/orgs/applications', { method: 'POST', body: { orgName } });
      ElMessage.success(t('organization.applicationSubmitted', { org: orgName }));
    } else {
      await apiRequest('/api/orgs', { method: 'POST', body: { orgName } });
      ElMessage.success(t('organization.orgCreated', { org: orgName }));
    }
    createDialogVisible.value = false;
    await loadOrgs();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

onMounted(async () => {
  try {
    const info = await apiRequest<{ orgRegistrationMode?: 'auto' | 'manual' }>('/api/public/platform-info');
    manualMode.value = info.orgRegistrationMode === 'manual';
  } catch {
    // 平台信息不可用时按即时创建处理，服务端仍会以 409 兜底拒绝
    manualMode.value = false;
  }
  await loadOrgs();
});
</script>

<style scoped>
.toolbar-end {
  margin-left: auto;
}

.page-error {
  margin-top: 16px;
}

.create-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}

.field-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.5;
}
</style>

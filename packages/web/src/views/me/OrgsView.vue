<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">我所在的组织</span>
        <div class="toolbar-end">
          <el-button type="primary" data-test="create-org" @click="openCreateDialog">创建组织</el-button>
        </div>
      </div>

      <el-table v-if="rows.length > 0" :data="rows" data-test="my-orgs-table" v-loading="loading">
        <el-table-column label="组织" min-width="180">
          <template #default="{ row }">@{{ row.org }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" :data-test="`org-status-${row.status}`">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="我的身份" width="180">
          <template #default="{ row }">
            <el-tag v-if="row.isOrgManager" type="primary" data-test="org-manager-tag">组织管理团队</el-tag>
            <el-tag v-else type="info" data-test="org-member-tag">组织成员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <!-- 治理入口只对组织管理团队成员渲染（ADR-0035）：其余成员看到的是只读视图 -->
            <el-button
              v-if="row.isOrgManager && (row.status === 'active' || row.status === 'delete_failed' || row.status === 'deleting')"
              link
              type="primary"
              :data-test="`manage-${row.org}`"
              @click="openOrg(row.org)"
            >
              {{ row.status === 'delete_failed' ? '重试删除' : '管理' }}
            </el-button>
            <el-button
              v-else-if="row.status === 'active'"
              link
              type="primary"
              :data-test="`browse-${row.org}`"
              @click="browseOrgSkills(row.org)"
            >
              查看技能
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && rows.length === 0" description="你还没有加入任何组织" />
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="createDialogVisible" :title="manualMode ? '申请创建组织' : '创建组织'" width="460px">
      <p class="create-hint">
        {{
          manualMode
            ? '当前平台为审批制：提交申请后由平台管理员审批，通过即开通，你自动成为组织管理团队成员。'
            : '组织创建后即时开通，你自动成为组织管理团队成员。'
        }}
      </p>
      <el-form label-width="90px">
        <el-form-item label="组织名" required>
          <el-input v-model="newOrgName" data-test="create-org-name" placeholder="小写字母、数字与连字符" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="create-org-submit" @click="submitCreate">
          {{ manualMode ? '提交申请' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

interface OrganizationRow {
  org: string;
  isOrgManager: boolean;
  /** 组织生命周期状态（ADR-0034）：active / pending / deleting / delete_failed … */
  status: string;
}

interface MyOrgsResponse {
  organizations: Array<{ org: string; isOrgManager: boolean; status: string }>;
  pendingApplications: Array<{ orgName: string; submittedAt: string }>;
}

// deleting / delete_failed 是需要被治理者看见的状态：组织不能悄悄消失，
// 删除失败也不是死局——列表上带状态、可回到组织详情重试（ADR-0034）。
const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  pending: '待审',
  deleting: '删除中',
  delete_failed: '删除失败',
  deleted: '已删除'
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

// 待审申请尚未产生组织，但它属于"我的组织"列表要呈现的状态（ADR-0035）。
const rows = computed<OrganizationRow[]>(() => {
  const memberships: OrganizationRow[] = response.value?.organizations ?? [];
  const pending: OrganizationRow[] = (response.value?.pendingApplications ?? []).map((application) => ({
    org: application.orgName,
    isOrgManager: false,
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
      organizations: response.value.organizations.map(({ org, isOrgManager }) => ({ org, isOrgManager }))
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
    errorMessage.value = '请输入组织名';
    return;
  }
  try {
    if (manualMode.value) {
      await apiRequest('/api/orgs/applications', { method: 'POST', body: { orgName } });
      ElMessage.success(`组织申请 ${orgName} 已提交，等待平台管理员审批`);
    } else {
      await apiRequest('/api/orgs', { method: 'POST', body: { orgName } });
      ElMessage.success(`组织 ${orgName} 已创建`);
    }
    createDialogVisible.value = false;
    await loadOrgs();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
</style>

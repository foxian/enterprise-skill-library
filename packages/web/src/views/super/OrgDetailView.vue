<template>
  <div>
    <el-breadcrumb class="page-breadcrumb" separator="/">
      <el-breadcrumb-item :to="{ name: 'super-orgs' }">组织管理</el-breadcrumb-item>
      <el-breadcrumb-item>{{ orgName }}</el-breadcrumb-item>
    </el-breadcrumb>
    <el-card class="data-card" shadow="never" data-test="org-summary">
      <el-descriptions :column="3" border>
        <el-descriptions-item label="组织名">{{ summary?.name ?? orgName }}</el-descriptions-item>
        <el-descriptions-item label="生命周期">
          <el-tag :type="orgStatusTagType(summary?.status)" data-test="org-status">{{ orgStatusText(summary?.status) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="成员数">{{ summary?.memberCount ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="技能数">{{ summary?.skillCount ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(summary?.createdAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-alert
      v-if="summary?.lastError"
      type="error"
      :title="`失败原因：${summary.lastError}`"
      :closable="false"
      class="page-error"
      data-test="org-last-error"
    />

    <!-- 平台管理员的成员兜底（ADR-0033）：超管不参与组织，因此不经成员身份
         也能查看与移除成员。治理不变量（至少保留一名管理团队成员）仍成立。 -->
    <el-card class="data-card" shadow="never" data-test="admin-members-card">
      <template #header>成员</template>
      <el-table v-if="members.length > 0" :data="members" data-test="admin-members-table" v-loading="membersLoading">
        <el-table-column prop="username" label="成员" />
        <el-table-column label="身份" width="170">
          <template #default="{ row }">
            <el-tag v-if="row.isOrgManager" type="primary" data-test="admin-member-is-manager">组织管理团队</el-tag>
            <el-tag v-else type="success">组织成员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :data-test="`admin-remove-${row.username}`"
              :disabled="row.isOrgManager && managerCount <= 1"
              :title="row.isOrgManager && managerCount <= 1 ? '组织管理团队必须至少保留一名成员' : ''"
              @click="removeMember(row)"
            >
              移出
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!membersLoading" description="组织暂无成员" />
      <el-alert v-if="memberError" type="error" :title="memberError" :closable="false" class="page-error" />
    </el-card>

    <el-card class="danger-zone" data-test="danger-zone">
      <template #header>危险操作</template>
      <p class="danger-hint">
        删除组织将移除其全部技能仓库与关联数据（成员是全局账号，不受影响），操作不可恢复。
        删除失败时可再次点击删除重试。
      </p>
      <el-input
        v-model="confirmInput"
        data-test="delete-confirm-input"
        placeholder="请输入组织名以确认删除"
        class="danger-input"
      />
      <el-button
        type="danger"
        data-test="delete-org-button"
        :disabled="confirmInput !== orgName || deleting"
        :loading="deleting"
        @click="confirmDelete"
      >
        彻底删除组织
      </el-button>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="二次确认" width="420px">
      <p>即将删除组织 <strong>{{ orgName }}</strong> 及其全部数据，该操作不可恢复。确认继续？</p>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="danger" data-test="delete-org-confirm" @click="deleteOrg">确认删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
  status?: string | null;
  lastError?: string | null;
}

const route = useRoute();
const router = useRouter();

interface AdminMemberView {
  username: string;
  isOrgManager: boolean;
}

const orgName = computed(() => String(route.params.orgName ?? ''));
const summary = ref<OrgSummary | null>(null);
const members = ref<AdminMemberView[]>([]);
const membersLoading = ref(false);
const memberError = ref('');
const managerCount = computed(() => members.value.filter((member) => member.isOrgManager).length);
const confirmInput = ref('');
const dialogVisible = ref(false);
const deleting = ref(false);
const errorMessage = ref('');

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

async function loadSummary(): Promise<void> {
  errorMessage.value = '';
  try {
    const orgs = await apiRequest<OrgSummary[]>('/api/admin/orgs');
    summary.value = orgs.find((org) => org.name === orgName.value) ?? null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function confirmDelete(): void {
  dialogVisible.value = true;
}

async function deleteOrg(): Promise<void> {
  deleting.value = true;
  try {
    await apiRequest(`/api/admin/orgs/${encodeURIComponent(orgName.value)}`, {
      method: 'DELETE',
      body: { confirm: orgName.value }
    });
    ElMessage.success(`组织 ${orgName.value} 已删除`);
    dialogVisible.value = false;
    await router.push({ name: 'super-orgs' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    deleting.value = false;
  }
}

async function loadMembers(): Promise<void> {
  membersLoading.value = true;
  memberError.value = '';
  try {
    members.value = await apiRequest<AdminMemberView[]>(
      `/api/admin/orgs/${encodeURIComponent(orgName.value)}/members`
    );
  } catch (error) {
    memberError.value = error instanceof Error ? error.message : String(error);
    members.value = [];
  } finally {
    membersLoading.value = false;
  }
}

async function removeMember(row: AdminMemberView): Promise<void> {
  memberError.value = '';
  try {
    await apiRequest(
      `/api/admin/orgs/${encodeURIComponent(orgName.value)}/members/${encodeURIComponent(row.username)}`,
      { method: 'DELETE' }
    );
    ElMessage.success(`成员 ${row.username} 已移出组织`);
    await Promise.all([loadMembers(), loadSummary()]);
  } catch (error) {
    memberError.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(async () => {
  await loadSummary();
  await loadMembers();
});
watch(orgName, () => {
  confirmInput.value = '';
  void loadSummary();
  void loadMembers();
});
</script>

<style scoped>
.page-breadcrumb {
  margin-bottom: 16px;
}

.retry-row {
  margin: 12px 0;
}

.danger-zone {
  margin-top: 16px;
  border-color: var(--el-color-danger-light-7);
}

.danger-hint {
  color: var(--el-color-danger);
  font-size: 13px;
}

.danger-input {
  width: 280px;
  margin-right: 12px;
}

.page-error {
  margin-top: 12px;
}
</style>

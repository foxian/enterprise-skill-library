<template>
  <div>
    <h2>组织详情：{{ orgName }}</h2>
    <el-descriptions :column="3" border data-test="org-summary">
      <el-descriptions-item label="组织名">{{ summary?.name ?? orgName }}</el-descriptions-item>
      <el-descriptions-item label="生命周期">
        <el-tag :type="statusTagType(summary?.status)" data-test="org-status">{{ statusText(summary?.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="成员数">{{ summary?.memberCount ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="技能数">{{ summary?.skillCount ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ formatTime(summary?.createdAt) }}</el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="summary?.lastError"
      type="error"
      :title="`失败原因：${summary.lastError.message}`"
      :description="`错误码：${summary.lastError.code}`"
      :closable="false"
      class="page-error"
      data-test="org-last-error"
    />
    <div v-if="summary?.status === 'delete_failed'" class="retry-row">
      <el-button type="warning" data-test="retry-operation" :loading="retrying" @click="retryOperation">
        重试删除流程
      </el-button>
    </div>

    <el-card class="danger-zone" data-test="danger-zone">
      <template #header>危险操作</template>
      <p class="danger-hint">
        删除组织将移除其全部技能仓库、成员账号与关联数据，操作不可恢复。
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

interface OrgSummary {
  name: string;
  memberCount: number;
  skillCount: number;
  createdAt?: string;
  status?: string | null;
  lastError?: { code: string; message: string; details: Record<string, unknown> } | null;
  operationId?: number | null;
}

const route = useRoute();
const router = useRouter();

const orgName = computed(() => String(route.params.orgName ?? ''));
const summary = ref<OrgSummary | null>(null);
const confirmInput = ref('');
const dialogVisible = ref(false);
const deleting = ref(false);
const retrying = ref(false);
const errorMessage = ref('');

const STATUS_TEXT: Record<string, string> = {
  pending: '待审批',
  provisioning: '开通中',
  active: '已激活',
  failed: '开通失败',
  rejected: '已拒绝',
  cancelled: '已取消',
  expired: '已过期',
  deleting: '删除中',
  delete_failed: '删除失败',
  deleted: '已删除'
};

function statusText(status?: string | null): string {
  if (!status) return '未纳管';
  return STATUS_TEXT[status] ?? status;
}

function statusTagType(status?: string | null): 'success' | 'warning' | 'danger' | 'info' {
  const mapping: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    active: 'success',
    pending: 'warning',
    provisioning: 'warning',
    deleting: 'warning',
    failed: 'danger',
    delete_failed: 'danger'
  };
  if (!status) return 'info';
  return mapping[status] ?? 'info';
}

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

async function retryOperation(): Promise<void> {
  if (!summary.value?.operationId) return;
  retrying.value = true;
  try {
    await apiRequest(`/api/admin/operations/${summary.value.operationId}/retry`, { method: 'POST' });
    ElMessage.success('已重新提交处理流程');
    await loadSummary();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    retrying.value = false;
  }
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

onMounted(loadSummary);
watch(orgName, () => {
  confirmInput.value = '';
  void loadSummary();
});
</script>

<style scoped>
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

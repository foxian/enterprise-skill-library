<template>
  <div>
    <el-breadcrumb class="page-breadcrumb" separator="/">
      <el-breadcrumb-item :to="{ name: 'super-orgs' }">{{ t('common.organizationManagement') }}</el-breadcrumb-item>
      <el-breadcrumb-item>{{ orgName }}</el-breadcrumb-item>
    </el-breadcrumb>
    <el-card class="data-card" shadow="never" data-test="org-summary">
      <el-descriptions :column="3" border>
        <el-descriptions-item :label="t('columns.organizationName')">{{ summary?.name ?? orgName }}</el-descriptions-item>
        <el-descriptions-item :label="t('columns.lifecycle')">
          <el-tag :type="orgStatusTagType(summary?.status)" data-test="org-status">{{ t(orgStatusText(summary?.status)) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item :label="t('columns.memberCount')">{{ summary?.memberCount == null ? '-' : formatNumber(summary.memberCount) }}</el-descriptions-item>
        <el-descriptions-item :label="t('columns.skillCount')">{{ summary?.skillCount == null ? '-' : formatNumber(summary.skillCount) }}</el-descriptions-item>
        <el-descriptions-item :label="t('columns.createdAt')">{{ formatDate(summary?.createdAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-alert
      v-if="summary?.lastError"
      type="error"
      :title="t('organization.failedReason', { reason: summary.lastError })"
      :closable="false"
      class="page-error"
      data-test="org-last-error"
    />

    <!-- 平台管理员的身份兜底（ADR-0038）：超管不参与组织，因此不经成员身份也能
         查看、变更身份与移出成员。"组织必须至少保留一名所有者成员"这条不变量对
         超管同样成立；此外超管还能**空降**——把组织外的人直接设为所有者成员，
         这是组织里确实无人可用时唯一不是"整体删除"的出路。 -->
    <el-card class="data-card" shadow="never" data-test="admin-members-card">
      <template #header>
        <div class="card-header">
          <span>{{ t('organization.membersTitle') }}</span>
          <el-button type="primary" size="small" data-test="admin-airdrop-open" @click="airdropVisible = true">
            {{ t('organization.ownerAirdropTitle') }}
          </el-button>
        </div>
      </template>
      <el-table v-if="members.length > 0" :data="members" data-test="admin-members-table" v-loading="membersLoading">
        <el-table-column prop="username" :label="t('columns.member')" />
        <el-table-column :label="t('columns.identity')" width="130">
          <template #default="{ row }">
            <el-tag :type="identityTagType(row.identity)" :data-test="`admin-identity-${row.identity}`">
              {{ t(identityLabel(row.identity)) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="320">
          <template #default="{ row }">
            <el-button
              v-for="next in promotionTargets(row)"
              :key="next"
              link
              type="primary"
              :data-test="`admin-set-${next}-${row.username}`"
              @click="changeIdentity(row.username, next)"
            >
              {{ t(promotionLabel(next)) }}
            </el-button>
            <el-button
              v-if="row.identity !== 'ordinary'"
              link
              type="warning"
              :data-test="`admin-demote-${row.username}`"
              :disabled="isLastOwner(row)"
              :title="isLastOwner(row) ? t('organization.lastOwnerDisabled') : ''"
              @click="changeIdentity(row.username, 'ordinary')"
            >
              {{ t('organization.demoteToOrdinary') }}
            </el-button>
            <el-button
              link
              type="danger"
              :data-test="`admin-remove-${row.username}`"
              :disabled="isLastOwner(row)"
              :title="isLastOwner(row) ? t('organization.lastOwnerDisabled') : ''"
              @click="removeMember(row)"
            >
              {{ t('actions.remove') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!membersLoading" :description="t('organization.noMembers')" />
      <el-alert v-if="memberError" type="error" :title="memberError" :closable="false" class="page-error" />
    </el-card>

    <el-card class="danger-zone" data-test="danger-zone">
      <template #header>{{ t('organization.dangerTitle') }}</template>
      <p class="danger-hint">
        {{ t('organization.deleteWarning') }}
        {{ t('organization.deleteRetryHint') }}
      </p>
      <el-input
        v-model="confirmInput"
        data-test="delete-confirm-input"
        :placeholder="t('organization.enterOrgNameToConfirm')"
        class="danger-input"
      />
      <el-button
        type="danger"
        data-test="delete-org-button"
        :disabled="confirmInput !== orgName || deleting"
        :loading="deleting"
        @click="confirmDelete"
      >
        {{ t('organization.permanentlyDelete') }}
      </el-button>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="dialogVisible" :title="t('organization.confirmTitle')" width="420px">
      <p>{{ t('organization.confirmDeleteWarning', { org: orgName }) }}</p>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" data-test="delete-org-confirm" @click="deleteOrg">{{ t('actions.confirmDelete') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="airdropVisible" :title="t('organization.ownerAirdropTitle')" width="460px">
      <p class="dialog-hint">
        {{ t('organization.ownerAirdropHint') }}
        {{ t('organization.ownerAirdropDetail') }}
      </p>
      <el-form label-width="100px">
        <el-form-item :label="t('registration.username')" required>
          <el-input v-model="airdropUsername" data-test="admin-airdrop-username" :placeholder="t('member.usernamePlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="airdropVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" data-test="admin-airdrop-submit" @click="airdropOwner">{{ t('actions.assign') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType, promotionLabel } from '../../constants/org-identity';
import { orgStatusTagType, orgStatusText } from '../../constants/org-status';

const { t, formatDate, formatNumber } = useLocaleState();

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
  identity: OrgIdentity;
}

const orgName = computed(() => String(route.params.orgName ?? ''));
const summary = ref<OrgSummary | null>(null);
const members = ref<AdminMemberView[]>([]);
const membersLoading = ref(false);
const memberError = ref('');
const ownerCount = computed(() => members.value.filter((member) => member.identity === 'owner').length);
const confirmInput = ref('');
const dialogVisible = ref(false);
const airdropVisible = ref(false);
const airdropUsername = ref('');
const deleting = ref(false);
const errorMessage = ref('');

/** 三档嵌套：往下的每一档都可作为提升目标；所有者成员没有可提的档。 */
function promotionTargets(member: AdminMemberView): Array<'managing' | 'owner'> {
  if (member.identity === 'ordinary') return ['managing', 'owner'];
  if (member.identity === 'managing') return ['owner'];
  return [];
}

/** 不变量（ADR-0038）：任何走法都不能让组织失去全部所有者成员。 */
function isLastOwner(member: AdminMemberView): boolean {
  return member.identity === 'owner' && ownerCount.value <= 1;
}

async function changeIdentity(username: string, identity: OrgIdentity): Promise<void> {
  memberError.value = '';
  try {
    await apiRequest(
      `/api/admin/orgs/${encodeURIComponent(orgName.value)}/members/${encodeURIComponent(username)}/identity`,
      { method: 'PUT', body: { identity } }
    );
    ElMessage.success(t('organization.identityChanged', { username, identity: t(identityLabel(identity)) }));
    await Promise.all([loadMembers(), loadSummary()]);
  } catch (error) {
    memberError.value = formatRequestError(error);
  }
}

async function airdropOwner(): Promise<void> {
  memberError.value = '';
  const username = airdropUsername.value.trim();
  if (!username) {
    memberError.value = t('organization.usernameRequired');
    return;
  }
  try {
    await apiRequest(
      `/api/admin/orgs/${encodeURIComponent(orgName.value)}/members/${encodeURIComponent(username)}/identity`,
      { method: 'PUT', body: { identity: 'owner' } }
    );
    airdropVisible.value = false;
    airdropUsername.value = '';
    ElMessage.success(t('organization.ownerAssigned', { username }));
    await Promise.all([loadMembers(), loadSummary()]);
  } catch (error) {
    memberError.value = formatRequestError(error);
  }
}

async function loadSummary(): Promise<void> {
  errorMessage.value = '';
  try {
    const orgs = await apiRequest<OrgSummary[]>('/api/admin/orgs');
    summary.value = orgs.find((org) => org.name === orgName.value) ?? null;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    ElMessage.success(t('organization.orgDeleted', { org: orgName.value }));
    dialogVisible.value = false;
    await router.push({ name: 'super-orgs' });
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    memberError.value = formatRequestError(error);
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
    ElMessage.success(t('organization.memberRemoved', { username: row.username }));
    await Promise.all([loadMembers(), loadSummary()]);
  } catch (error) {
    memberError.value = formatRequestError(error);
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}
</style>

<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">{{ t('member.count', { count: formatNumber(members.length) }) }}</span>
        <div class="toolbar-end">
          <el-button type="primary" data-test="open-add-member" @click="addDialogVisible = true">{{ t('actions.addMember') }}</el-button>
        </div>
      </div>

      <el-table v-if="members.length > 0" :data="members" data-test="members-table" v-loading="loading">
        <el-table-column :label="t('columns.member')">
          <template #default="{ row }">{{ row.username }}</template>
        </el-table-column>
        <el-table-column :label="t('columns.identity')" width="130">
          <template #default="{ row }">
            <el-tag :type="identityTagType(row.identity)" :data-test="`identity-${row.identity}`">
              {{ t(identityLabel(row.identity)) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="320">
          <template #default="{ row }">
            <template v-if="canGovern">
              <!-- 身份变更是一等动作（ADR-0038）。三档嵌套，所以可用的动作就是
                   "往下补"与"往上收"两件，直落普通成员，没有中间档。 -->
              <el-button
                v-for="next in promotionTargets(row)"
                :key="next"
                link
                type="primary"
                :data-test="`set-${next}-${row.username}`"
                @click="changeIdentity(row, next)"
              >
                {{ t(promotionLabel(next)) }}
              </el-button>
              <el-button
                v-if="row.identity !== 'ordinary'"
                link
                type="warning"
                :data-test="`demote-${row.username}`"
                :disabled="!canDemote(row)"
                :title="t(demoteBlockReason(row))"
                @click="changeIdentity(row, 'ordinary')"
              >
                {{ t('organization.demoteToOrdinary') }}
              </el-button>
              <!-- 互管与"至少保留一名所有者成员"（ADR-0038）在服务端兜底，
                   前端按同一规则禁用，以免点了才吃 400 -->
              <el-button
                link
                type="danger"
                :data-test="`remove-${row.username}`"
                :disabled="!canRemove(row)"
                :title="t(removalBlockReason(row))"
                @click="openRemove(row)"
              >
                {{ row.username === auth.username ? t('actions.leaveOrganization') : t('actions.remove') }}
              </el-button>
            </template>
            <el-button
              v-else-if="row.username === auth.username"
              link
              type="danger"
              :data-test="`remove-${row.username}`"
              @click="openRemove(row)"
            >
              {{ t('actions.leaveOrganization') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!loading" :description="t('organization.noMembers')" />
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-card v-if="inviteMode && canGovern" class="data-card" shadow="never">
      <template #header>{{ t('member.pendingInvitationsTitle') }}</template>
      <el-table
        v-if="invitations.length > 0"
        :data="invitations"
        data-test="pending-invitations-table"
        v-loading="invitationsLoading"
      >
        <el-table-column prop="username" :label="t('columns.invitedUser')" />
        <el-table-column prop="invitedBy" :label="t('columns.inviter')" width="180" />
        <el-table-column :label="t('columns.actions')" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :data-test="`revoke-invitation-${row.username}`"
              @click="revokeInvitation(row)"
            >
              {{ t('actions.revoke') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!invitationsLoading" :description="t('member.noPendingInvitations')" />
    </el-card>

    <el-dialog v-model="addDialogVisible" :title="t('member.addTitle')" width="420px">
      <p v-if="inviteMode" class="dialog-hint">{{ t('member.invitationModeHint') }}</p>
      <el-form label-width="100px">
        <el-form-item :label="t('registration.username')" required>
          <el-input v-model="addUsername" data-test="add-member-username" :placeholder="t('member.usernamePlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" data-test="add-member-submit" @click="addMember">
          {{ inviteMode ? t('actions.sendInvite') : t('actions.add') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="removeDialogVisible" :title="leaveSelf ? t('member.leaveTitle') : t('member.removeTitle')" width="420px">
      <p v-if="leaveSelf">
        {{ t('member.leaveWarning', { org }) }}
      </p>
      <p v-else>
        {{ t('member.removeWarning', { member: removeTarget }) }}
      </p>
      <template #footer>
        <el-button @click="removeDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="danger" data-test="remove-member-confirm" @click="removeMember">
          {{ leaveSelf ? t('actions.confirmLeave') : t('actions.confirmRemove') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType, promotionLabel } from '../../constants/org-identity';
import { useAuthStore, type SessionOrganization } from '../../stores/auth';

const { t, formatNumber } = useLocaleState();

interface OrgMemberView {
  username: string;
  identity: OrgIdentity;
}

interface InvitationView {
  id: number;
  username: string;
  invitedBy: string;
}

// 组织由路由显式指名（ADR-0035），不再是会话里的隐式"当前组织"。
const route = useRoute();
const auth = useAuthStore();
const org = computed<string>(() => String(route.params.org ?? ''));

const members = ref<OrgMemberView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const invitations = ref<InvitationView[]>([]);
const invitationsLoading = ref(false);

const addDialogVisible = ref(false);
const addUsername = ref('');

const removeDialogVisible = ref(false);
const removeTarget = ref('');

const inviteMode = computed(() => platformInfo.value?.memberAddMode === 'invite');
const platformInfo = ref<{ memberAddMode?: 'direct' | 'invite' } | null>(null);

const ownerCount = computed(() => members.value.filter((member) => member.identity === 'owner').length);
const leaveSelf = computed(() => removeTarget.value === auth.username);
const canGovern = computed(() => auth.isOwnerMember(org.value));

/** 三档嵌套：往下的每一档都可作为提升目标；所有者成员没有可提的档。 */
function promotionTargets(member: OrgMemberView): Array<'managing' | 'owner'> {
  if (member.identity === 'ordinary') return ['managing', 'owner'];
  if (member.identity === 'managing') return ['owner'];
  return [];
}

/**
 * 服务端不变量（ADR-0038）的镜像：**任何走法都不能让组织失去全部所有者成员**——
 * 被他人移出、自我降级、自我退出，三者同一条规则。除此之外，把自己降级或退出
 * 都是正当动作，前端不再拦。
 */
function demoteBlockReason(member: OrgMemberView): string {
  if (member.identity === 'owner' && ownerCount.value <= 1) {
    return 'organization.lastOwnerDisabled';
  }
  return '';
}

function removalBlockReason(member: OrgMemberView): string {
  if (member.identity === 'owner' && ownerCount.value <= 1) {
    return 'organization.lastOwnerDisabled';
  }
  return '';
}

function canDemote(member: OrgMemberView): boolean {
  return demoteBlockReason(member) === '';
}

function canRemove(member: OrgMemberView): boolean {
  return removalBlockReason(member) === '';
}

async function loadMembers(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    members.value = await apiRequest<OrgMemberView[]>(`/api/orgs/${org.value}/members`);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * 身份可能变的是自己（自我降级、自我退出），会话里的组织列表要跟着刷新，
 * 否则路由守卫会拿旧身份放行。
 */
async function refreshSessionOrganizations(): Promise<void> {
  try {
    const mine = await apiRequest<{ organizations: SessionOrganization[] }>('/api/orgs/mine');
    if (auth.session) {
      auth.establish({ ...auth.session, organizations: mine.organizations });
    }
  } catch {
    // 刷新失败不阻断列表更新：服务端每次请求仍会按真实身份复检
  }
}

async function loadInvitations(): Promise<void> {
  if (!inviteMode.value || !canGovern.value) return;
  invitationsLoading.value = true;
  try {
    invitations.value = await apiRequest<InvitationView[]>(`/api/orgs/${org.value}/invitations`);
  } catch {
    invitations.value = [];
  } finally {
    invitationsLoading.value = false;
  }
}

async function changeIdentity(member: OrgMemberView, identity: OrgIdentity): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/members/${encodeURIComponent(member.username)}/identity`, {
      method: 'PUT',
      body: { identity }
    });
    ElMessage.success(t('organization.identityChanged', { username: member.username, identity: t(identityLabel(identity)) }));
    await Promise.all([loadMembers(), refreshSessionOrganizations()]);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  if (!addUsername.value.trim()) {
    errorMessage.value = t('member.usernameRequired');
    return;
  }
  try {
    const result = await apiRequest<{ status: string; username: string }>(`/api/orgs/${org.value}/members`, {
      method: 'POST',
      body: { username: addUsername.value.trim() }
    });
    addDialogVisible.value = false;
    addUsername.value = '';
    if (result.status === 'invited') {
      ElMessage.success(t('member.inviteSent', { member: result.username }));
    } else {
      ElMessage.success(t('member.memberAdded', { member: result.username }));
    }
    await Promise.all([loadMembers(), loadInvitations()]);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

function openRemove(row: OrgMemberView): void {
  removeTarget.value = row.username;
  removeDialogVisible.value = true;
}

async function removeMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/members/${encodeURIComponent(removeTarget.value)}`, {
      method: 'DELETE'
    });
    removeDialogVisible.value = false;
    ElMessage.success(
      leaveSelf.value
        ? t('member.selfLeft', { org: org.value })
        : t('member.memberRemoved', { member: removeTarget.value })
    );
    await Promise.all([loadMembers(), refreshSessionOrganizations()]);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function revokeInvitation(row: InvitationView): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/invitations/${row.id}`, { method: 'DELETE' });
    ElMessage.success(t('member.inviteRevoked', { member: row.username }));
    await loadInvitations();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

onMounted(async () => {
  try {
    platformInfo.value = await apiRequest('/api/public/platform-info');
  } catch {
    platformInfo.value = null;
  }
  await Promise.all([loadMembers(), loadInvitations()]);
});
</script>

<style scoped>
.toolbar-end {
  margin-left: auto;
}

.page-error {
  margin-top: 16px;
}

.dialog-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}
</style>

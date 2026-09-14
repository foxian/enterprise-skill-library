<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">成员 {{ members.length }} 人</span>
        <div class="toolbar-end">
          <el-button type="primary" data-test="open-add-member" @click="addDialogVisible = true">添加成员</el-button>
        </div>
      </div>

      <el-table v-if="members.length > 0" :data="members" data-test="members-table" v-loading="loading">
        <el-table-column label="成员">
          <template #default="{ row }">{{ row.username }}</template>
        </el-table-column>
        <el-table-column label="身份" width="130">
          <template #default="{ row }">
            <el-tag :type="identityTagType(row.identity)" :data-test="`identity-${row.identity}`">
              {{ identityLabel(row.identity) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320">
          <template #default="{ row }">
            <!-- 身份变更是一等动作（ADR-0036）。三档嵌套，所以可用的动作就是
                 "往下补"与"往上收"两件，直落普通成员，没有中间档。 -->
            <el-button
              v-for="next in promotionTargets(row)"
              :key="next"
              link
              type="primary"
              :data-test="`set-${next}-${row.username}`"
              @click="changeIdentity(row, next)"
            >
              {{ promotionLabel(next) }}
            </el-button>
            <el-button
              v-if="row.identity !== 'ordinary'"
              link
              type="warning"
              :data-test="`demote-${row.username}`"
              :disabled="!canDemote(row)"
              :title="demoteBlockReason(row)"
              @click="changeIdentity(row, 'ordinary')"
            >
              收回为普通成员
            </el-button>
            <!-- 互管与"至少保留一名所有者成员"（ADR-0036）在服务端兜底，
                 前端按同一规则禁用，以免点了才吃 400 -->
            <el-button
              link
              type="danger"
              :data-test="`remove-${row.username}`"
              :disabled="!canRemove(row)"
              :title="removalBlockReason(row)"
              @click="openRemove(row)"
            >
              {{ row.username === auth.username ? '退出组织' : '移出' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!loading" description="组织暂无成员" />
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-card v-if="inviteMode" class="data-card" shadow="never">
      <template #header>待接受的邀请</template>
      <el-table
        v-if="invitations.length > 0"
        :data="invitations"
        data-test="pending-invitations-table"
        v-loading="invitationsLoading"
      >
        <el-table-column prop="username" label="被邀请人" />
        <el-table-column prop="invitedBy" label="邀请人" width="180" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :data-test="`revoke-invitation-${row.username}`"
              @click="revokeInvitation(row)"
            >
              撤销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!invitationsLoading" description="没有待接受的邀请" />
    </el-card>

    <el-dialog v-model="addDialogVisible" title="添加成员" width="420px">
      <p v-if="inviteMode" class="dialog-hint">当前平台为邀请制：对方接受邀请后才会加入组织。</p>
      <el-form label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="addUsername" data-test="add-member-username" placeholder="对方的全局账号用户名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="add-member-submit" @click="addMember">
          {{ inviteMode ? '发送邀请' : '添加' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="removeDialogVisible" :title="leaveSelf ? '退出组织' : '移出成员'" width="420px">
      <p v-if="leaveSelf">
        退出后你将离开 <strong>@{{ org }}</strong> 并从全部团队移出；你在平台上的账号不受影响。
      </p>
      <p v-else>
        移出后 <strong>{{ removeTarget }}</strong> 将离开组织并从全部团队移出。确认继续？
      </p>
      <template #footer>
        <el-button @click="removeDialogVisible = false">取消</el-button>
        <el-button type="danger" data-test="remove-member-confirm" @click="removeMember">
          {{ leaveSelf ? '确认退出' : '确认移出' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType, promotionLabel } from '../../constants/org-identity';
import { useAuthStore, type SessionOrganization } from '../../stores/auth';

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

/** 三档嵌套：往下的每一档都可作为提升目标；所有者成员没有可提的档。 */
function promotionTargets(member: OrgMemberView): Array<'managing' | 'owner'> {
  if (member.identity === 'ordinary') return ['managing', 'owner'];
  if (member.identity === 'managing') return ['owner'];
  return [];
}

/**
 * 服务端不变量（ADR-0036）的镜像：**任何走法都不能让组织失去全部所有者成员**——
 * 被他人移出、自我降级、自我退出，三者同一条规则。除此之外，把自己降级或退出
 * 都是正当动作，前端不再拦。
 */
function demoteBlockReason(member: OrgMemberView): string {
  if (member.identity === 'owner' && ownerCount.value <= 1) {
    return '组织必须至少保留一名所有者成员';
  }
  return '';
}

function removalBlockReason(member: OrgMemberView): string {
  if (member.identity === 'owner' && ownerCount.value <= 1) {
    return '组织必须至少保留一名所有者成员';
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
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
  if (!inviteMode.value) return;
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
    ElMessage.success(`${member.username} 现在是${identityLabel(identity)}`);
    await Promise.all([loadMembers(), refreshSessionOrganizations()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  if (!addUsername.value.trim()) {
    errorMessage.value = '请输入用户名';
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
      ElMessage.success(`已向 ${result.username} 发送入组邀请`);
    } else {
      ElMessage.success(`成员 ${result.username} 已加入组织`);
    }
    await Promise.all([loadMembers(), loadInvitations()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
      leaveSelf.value ? `你已退出 @${org.value}` : `成员 ${removeTarget.value} 已移出组织`
    );
    await Promise.all([loadMembers(), refreshSessionOrganizations()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function revokeInvitation(row: InvitationView): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/invitations/${row.id}`, { method: 'DELETE' });
    ElMessage.success(`已撤销对 ${row.username} 的邀请`);
    await loadInvitations();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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

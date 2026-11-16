<template>
  <div>
    <div v-if="emailNotice" class="email-notice" :data-test="`email-notice-${emailNotice.type}`">
      <el-alert :type="emailNotice.type" :closable="false">
        <template #title>
          <div class="email-notice-content">
            <span>{{ t(emailNotice.messageKey) }}</span>
            <el-button link type="primary" data-test="go-personal-info" @click="goPersonalInfo">
              {{ t(emailNotice.actionKey) }}
            </el-button>
          </div>
        </template>
      </el-alert>
    </div>

    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('overview.todos') }}</span>
          <el-tag v-if="todoCount > 0" type="warning" size="small" data-test="todo-count">{{ todoCount }}</el-tag>
        </div>
      </template>
      <el-empty v-if="todoCount === 0" :description="t('overview.noTodos')" />
      <ul v-else class="todo-list">
        <li v-for="invitation in invitations" :key="`invitation-${invitation.id}`">
          {{ t('overview.orgInvitation', { org: invitation.orgName }) }}
          <el-button link type="primary" data-test="go-invitations" @click="goInvitations">{{ t('overview.handle') }}</el-button>
        </li>
        <li v-for="application in pendingApplications" :key="`application-${application.orgName}`">
          {{ t('overview.orgApplication', { org: application.orgName }) }}
        </li>
      </ul>
    </el-card>

    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('nav.myOrganizations') }}</span>
          <el-button link type="primary" data-test="go-orgs" @click="goOrgs">{{ t('overview.allOrganizations') }}</el-button>
        </div>
      </template>
      <el-empty v-if="organizations.length === 0" :description="t('organization.noOrganizations')" />
      <div v-else class="org-chips">
        <el-tag
          v-for="membership in organizations"
          :key="membership.org"
          :type="identityTagType(membership.identity)"
          size="large"
        >
          @{{ membership.org }} · {{ t(identityLabel(membership.identity)) }}
        </el-tag>
      </div>
    </el-card>

    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('overview.managedSkills') }}</span>
          <el-button link type="primary" data-test="go-skills" @click="goSkills">{{ t('overview.allSkills') }}</el-button>
        </div>
      </template>
      <el-empty v-if="!loading && managedSkills.length === 0" :description="t('overview.noManagedSkills')" />
      <el-table v-else :data="managedSkills.slice(0, 5)" data-test="overview-managed-skills" v-loading="loading">
        <el-table-column :label="t('skill.name')" min-width="240">
          <template #default="{ row }">
            <SkillIdentity :skill="row" />
          </template>
        </el-table-column>
        <el-table-column :label="t('columns.actions')" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`manage-skill-${row.skillName}`"
              @click="openSkill(row.scope, row.skillName)"
            >
              {{ t('actions.manage') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import SkillIdentity from '../../components/SkillIdentity.vue';
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType } from '../../constants/org-identity';
import { loadSkillInventorySummaries, type SkillInventoryItem } from '../../skills/skill-list';
import { useAuthStore, type SessionOrganization } from '../../stores/auth';

const { t } = useLocaleState();

interface Invitation {
  id: number;
  orgName: string;
}

interface PendingApplication {
  orgName: string;
}

/** 概览页只关心邮箱状态，用于渲染提醒横幅；邮箱展示与修改在个人信息页。 */
interface EmailStatus {
  emailPendingCompletion: boolean;
  emailPendingVerification?: boolean;
}

interface EmailNotice {
  type: 'warning' | 'info';
  messageKey: string;
  actionKey: string;
}

const router = useRouter();
const auth = useAuthStore();

const invitations = ref<Invitation[]>([]);
const pendingApplications = ref<PendingApplication[]>([]);
const managedSkills = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const emailStatus = ref<EmailStatus | null>(null);

const organizations = computed(() => auth.organizations);
const todoCount = computed(() => invitations.value.length + pendingApplications.value.length);
// 待补全用 warning 保持醒目；待验证用 info 降低打扰强度，两者结构一致。
// 待补全用户提交改邮后两个标记会同时为真，此时以待验证为准（与个人信息页标签优先级一致）。
const emailNotice = computed<EmailNotice | null>(() => {
  if (emailStatus.value?.emailPendingVerification) {
    return {
      type: 'info',
      messageKey: 'overview.emailPendingVerificationBanner',
      actionKey: 'overview.viewEmailStatus'
    };
  }
  if (emailStatus.value?.emailPendingCompletion) {
    return {
      type: 'warning',
      messageKey: 'overview.emailPendingCompletionBanner',
      actionKey: 'overview.goCompleteEmail'
    };
  }
  return null;
});

function goInvitations(): void {
  void router.push({ name: 'me-invitations' });
}

function goOrgs(): void {
  void router.push({ name: 'me-orgs' });
}

function goSkills(): void {
  void router.push({ name: 'me-skills' });
}

function goPersonalInfo(): void {
  void router.push({ name: 'me-personal-info', hash: '#email' });
}

function openSkill(scope: string, skillName: string): void {
  void router.push({ name: 'me-skill-manage', params: { scope, skillName } });
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  // 待办与技能来自不同端点，任一失败不应让整页空掉，故各自兜底。
  const [invitationResult, orgResult, skillResult, emailResult] = await Promise.allSettled([
    apiRequest<Invitation[]>('/api/orgs/invitations'),
    apiRequest<{ organizations: SessionOrganization[]; pendingApplications: PendingApplication[] }>(
      '/api/orgs/mine'
    ),
    loadSkillInventorySummaries(),
    apiRequest<EmailStatus>('/api/account/profile')
  ]);

  if (invitationResult.status === 'fulfilled') {
    invitations.value = invitationResult.value;
  }
  if (orgResult.status === 'fulfilled') {
    pendingApplications.value = orgResult.value.pendingApplications;
    if (auth.session) {
      auth.establish({ ...auth.session, organizations: orgResult.value.organizations });
    }
  }
  if (skillResult.status === 'fulfilled') {
    managedSkills.value = skillResult.value.filter((item) => item.relation === 'managed');
  }
  if (emailResult.status === 'fulfilled') {
    emailStatus.value = emailResult.value;
  }

  const failure = [invitationResult, orgResult, skillResult, emailResult].find(
    (result) => result.status === 'rejected'
  );
  if (failure && failure.status === 'rejected') {
    const reason: unknown = failure.reason;
    errorMessage.value = formatRequestError(reason);
  }
  loading.value = false;
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.email-notice {
  margin-bottom: 16px;
}

.email-notice-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.todo-list {
  margin: 0;
  padding-left: 20px;
  line-height: 2;
}

.org-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page-error {
  margin-top: 16px;
}
</style>

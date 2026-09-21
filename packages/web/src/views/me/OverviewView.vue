<template>
  <div>
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
      <el-table v-else :data="managedSkills" data-test="overview-managed-skills" v-loading="loading">
        <el-table-column prop="name" :label="t('skill.name')" />
        <el-table-column :label="t('columns.namespace')" width="160">
          <template #default="{ row }">@{{ row.scope }}</template>
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

    <el-card v-if="profile" class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('profile.emailTitle') }}</span>
          <el-tag v-if="profile.emailPendingCompletion" type="warning" size="small" data-test="email-pending-reminder">
            {{ t('userManagement.emailPendingCompletion') }}
          </el-tag>
        </div>
      </template>
      <p class="profile-email" data-test="profile-email">{{ profile.email }}</p>
      <el-alert
        v-if="profile.emailPendingCompletion"
        type="warning"
        :title="t('profile.emailPendingHint')"
        :closable="false"
        class="profile-alert"
      />
      <el-form label-position="top" class="profile-form" @submit.prevent="changeEmail">
        <el-form-item :label="t('profile.newEmail')" required>
          <el-input v-model="newEmail" data-test="profile-email-input" />
        </el-form-item>
        <el-form-item :label="t('profile.currentPassword')" required>
          <el-input
            v-model="currentPassword"
            data-test="profile-current-password"
            type="password"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="savingEmail"
          data-test="profile-email-submit"
        >
          {{ t('profile.saveEmail') }}
        </el-button>
      </el-form>
    </el-card>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';
import { ElMessage } from 'element-plus';
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

interface AccountProfile {
  username: string;
  email: string;
  emailPendingCompletion: boolean;
}

const router = useRouter();
const auth = useAuthStore();

const invitations = ref<Invitation[]>([]);
const pendingApplications = ref<PendingApplication[]>([]);
const managedSkills = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const profile = ref<AccountProfile | null>(null);
const newEmail = ref('');
const currentPassword = ref('');
const savingEmail = ref(false);

const organizations = computed(() => auth.organizations);
const todoCount = computed(() => invitations.value.length + pendingApplications.value.length);

function goInvitations(): void {
  void router.push({ name: 'me-invitations' });
}

function goOrgs(): void {
  void router.push({ name: 'me-orgs' });
}

function goSkills(): void {
  void router.push({ name: 'me-skills' });
}

function openSkill(scope: string, skillName: string): void {
  void router.push({ name: 'me-skill-manage', params: { scope, skillName } });
}

async function changeEmail(): Promise<void> {
  savingEmail.value = true;
  errorMessage.value = '';
  try {
    profile.value = await apiRequest<AccountProfile>('/api/account/email', {
      method: 'PUT',
      body: {
        email: newEmail.value.trim(),
        currentPassword: currentPassword.value
      }
    });
    currentPassword.value = '';
    ElMessage.success(t('profile.emailChanged'));
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    savingEmail.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  // 待办与技能来自不同端点，任一失败不应让整页空掉，故各自兜底。
  const [invitationResult, orgResult, skillResult, profileResult] = await Promise.allSettled([
    apiRequest<Invitation[]>('/api/orgs/invitations'),
    apiRequest<{ organizations: SessionOrganization[]; pendingApplications: PendingApplication[] }>(
      '/api/orgs/mine'
    ),
    loadSkillInventorySummaries(),
    apiRequest<AccountProfile>('/api/account/profile')
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
  if (profileResult.status === 'fulfilled') {
    profile.value = profileResult.value;
    newEmail.value = profileResult.value.email;
  }

  const failure = [invitationResult, orgResult, skillResult, profileResult].find(
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

.profile-email {
  margin: 0 0 12px;
  font-weight: 600;
}

.profile-alert {
  margin-bottom: 16px;
}

.profile-form {
  max-width: 520px;
}
</style>

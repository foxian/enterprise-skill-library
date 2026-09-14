<template>
  <div>
    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>待办</span>
          <el-tag v-if="todoCount > 0" type="warning" size="small" data-test="todo-count">{{ todoCount }}</el-tag>
        </div>
      </template>
      <el-empty v-if="todoCount === 0" description="没有待处理的事项" />
      <ul v-else class="todo-list">
        <li v-for="invitation in invitations" :key="`invitation-${invitation.id}`">
          组织 <strong>@{{ invitation.orgName }}</strong> 邀请你加入
          <el-button link type="primary" data-test="go-invitations" @click="goInvitations">去处理</el-button>
        </li>
        <li v-for="application in pendingApplications" :key="`application-${application.orgName}`">
          组织申请 <strong>@{{ application.orgName }}</strong> 待平台管理员审批
        </li>
      </ul>
    </el-card>

    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>我的组织</span>
          <el-button link type="primary" data-test="go-orgs" @click="goOrgs">全部组织</el-button>
        </div>
      </template>
      <el-empty v-if="organizations.length === 0" description="你还没有加入任何组织" />
      <div v-else class="org-chips">
        <el-tag
          v-for="membership in organizations"
          :key="membership.org"
          :type="identityTagType(membership.identity)"
          size="large"
        >
          @{{ membership.org }} · {{ identityLabel(membership.identity) }}
        </el-tag>
      </div>
    </el-card>

    <el-card class="data-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>我管理的技能</span>
          <el-button link type="primary" data-test="go-skills" @click="goSkills">全部技能</el-button>
        </div>
      </template>
      <el-empty v-if="!loading && managedSkills.length === 0" description="你还没有管理任何技能" />
      <el-table v-else :data="managedSkills" data-test="overview-managed-skills" v-loading="loading">
        <el-table-column prop="name" label="技能名" />
        <el-table-column label="命名空间" width="160">
          <template #default="{ row }">@{{ row.scope }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`manage-skill-${row.skillName}`"
              @click="openSkill(row.scope, row.skillName)"
            >
              管理
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../../api/client';
import { identityLabel, identityTagType } from '../../constants/org-identity';
import { loadSkillInventorySummaries, type SkillInventoryItem } from '../../skills/skill-list';
import { useAuthStore, type SessionOrganization } from '../../stores/auth';

interface Invitation {
  id: number;
  orgName: string;
}

interface PendingApplication {
  orgName: string;
}

const router = useRouter();
const auth = useAuthStore();

const invitations = ref<Invitation[]>([]);
const pendingApplications = ref<PendingApplication[]>([]);
const managedSkills = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');

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

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  // 待办与技能来自不同端点，任一失败不应让整页空掉，故各自兜底。
  const [invitationResult, orgResult, skillResult] = await Promise.allSettled([
    apiRequest<Invitation[]>('/api/orgs/invitations'),
    apiRequest<{ organizations: SessionOrganization[]; pendingApplications: PendingApplication[] }>(
      '/api/orgs/mine'
    ),
    loadSkillInventorySummaries()
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

  const failure = [invitationResult, orgResult, skillResult].find((result) => result.status === 'rejected');
  if (failure && failure.status === 'rejected') {
    const reason: unknown = failure.reason;
    errorMessage.value = reason instanceof Error ? reason.message : String(reason);
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
</style>

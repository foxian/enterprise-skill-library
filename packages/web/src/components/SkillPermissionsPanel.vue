<template>
  <div data-test="skill-permissions-panel">
    <div class="console-toolbar">
      <h2>技能权限：@{{ scope }}/{{ skillName }}</h2>
      <el-tag :type="stateTagType" data-test="share-state">{{ stateText }}</el-tag>
    </div>

    <el-card class="section-card">
      <template #header>当前共享状态</template>
      <el-space wrap>
        <el-tag v-if="matrix.sharedAllRead" type="success">全员只读</el-tag>
        <el-tag v-if="matrix.sharedAllWrite" type="warning">全员读写</el-tag>
        <el-tag v-for="team in matrix.teams" :key="team.id" data-test="granted-team">
          团队 {{ team.name }}（{{ permissionText(team.permission) }}）
        </el-tag>
        <el-tag v-for="member in matrix.members" :key="member.username" type="info" data-test="granted-member">
          {{ member.username }}（{{ permissionText(member.permission) }}）
        </el-tag>
      </el-space>
    </el-card>

    <el-card class="section-card">
      <template #header>快捷操作</template>
      <el-space>
        <el-button data-test="share-all-read" @click="applyAction('share_all_read')">共享全员只读</el-button>
        <el-button data-test="share-all-write" @click="applyAction('share_all_write')">共享全员读写</el-button>
        <el-button type="warning" data-test="reset-to-private" @click="applyAction('reset_to_private')">
          重置为私有
        </el-button>
      </el-space>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>团队授权</template>
          <div class="grant-row">
            <el-select
              v-if="teamOptions.length"
              v-model="selectedTeam"
              data-test="team-select"
              placeholder="选择团队"
              style="width: 220px"
            >
              <el-option v-for="team in teamOptions" :key="team.name" :label="teamLabel(team)" :value="team.name" />
            </el-select>
            <el-input v-else v-model="selectedTeam" data-test="team-input" placeholder="团队名" style="width: 220px" />
            <el-button type="primary" data-test="grant-team" @click="grantTeam">添加授权</el-button>
          </div>
          <el-table v-if="matrix.teams.length" :data="matrix.teams" size="small">
            <el-table-column prop="name" label="团队" />
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button
                  link
                  type="danger"
                  :data-test="`revoke-team-${row.name}`"
                  @click="applyAction('remove_team', { team: row.name })"
                >
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>成员授权</template>
          <div class="grant-row">
            <el-select
              v-if="memberOptions.length"
              v-model="selectedMember"
              filterable
              allow-create
              data-test="member-select"
              placeholder="成员用户名"
              style="width: 220px"
            >
              <el-option v-for="member in memberOptions" :key="member.username" :value="member.username" />
            </el-select>
            <el-input v-else v-model="selectedMember" data-test="member-input" placeholder="成员用户名（含组织前缀）" style="width: 220px" />
            <el-select v-model="memberPermission" data-test="member-permission" style="width: 100px">
              <el-option label="只读" value="read" />
              <el-option label="读写" value="write" />
            </el-select>
            <el-button type="primary" data-test="grant-member" @click="grantMember">添加授权</el-button>
          </div>
          <el-table v-if="matrix.members.length" :data="matrix.members" size="small">
            <el-table-column prop="username" label="成员" />
            <el-table-column label="权限" width="80">
              <template #default="{ row }">{{ permissionText(row.permission) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button
                  link
                  type="danger"
                  :data-test="`revoke-member-${row.username}`"
                  @click="applyAction('remove_member', { username: row.username })"
                >
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../api/client';
import {
  deriveShareState,
  type MemberOption,
  type PermissionMatrix,
  type TeamOption
} from '../skills/skill-list';

const props = defineProps<{
  scope: string;
  skillName: string;
  teamOptions?: TeamOption[];
  memberOptions?: MemberOption[];
}>();

const matrix = ref<PermissionMatrix>({
  scope: props.scope,
  skillName: props.skillName,
  sharedAllRead: false,
  sharedAllWrite: false,
  teams: [],
  members: []
});
const errorMessage = ref('');

const selectedTeam = ref('');
const selectedMember = ref('');
const memberPermission = ref<'read' | 'write'>('read');

// 组织管理员提供团队/成员下拉建议；普通成员视角退化为手工输入
const teamOptions = computed(() => props.teamOptions ?? []);
const memberOptions = computed(() => props.memberOptions ?? []);

const shareState = computed(() => deriveShareState(matrix.value));

const stateText = computed(() => shareState.value.text);

const stateTagType = computed(() => shareState.value.tagType);

function permissionText(permission: string): string {
  return permission === 'write' ? '读写' : '只读';
}

function teamLabel(team: TeamOption): string {
  return `${team.name}（${permissionText(team.permission)}）`;
}

async function loadMatrix(): Promise<void> {
  errorMessage.value = '';
  try {
    matrix.value = await apiRequest<PermissionMatrix>(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/permissions`
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

// 返回操作是否成功，便于调用方决定是否清空输入并提示成功
async function applyAction(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  errorMessage.value = '';
  try {
    // 每次操作返回最新权限矩阵，直接刷新页面状态
    matrix.value = await apiRequest<PermissionMatrix>(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/permissions`,
      { method: 'POST', body: { action, ...extra } }
    );
    return true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function grantTeam(): Promise<void> {
  if (!selectedTeam.value) {
    errorMessage.value = '请选择或输入团队名';
    return;
  }
  const team = selectedTeam.value;
  if (await applyAction('add_team', { team })) {
    selectedTeam.value = '';
    ElMessage.success('团队授权已更新');
  }
}

async function grantMember(): Promise<void> {
  if (!selectedMember.value) {
    errorMessage.value = '请选择或输入成员用户名';
    return;
  }
  const username = selectedMember.value;
  if (await applyAction('add_member', { username, permission: memberPermission.value })) {
    selectedMember.value = '';
    ElMessage.success('成员授权已更新');
  }
}

onMounted(loadMatrix);
</script>

<style scoped>
.section-card {
  margin-bottom: 16px;
}

.grant-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.page-error {
  margin-top: 16px;
}
</style>

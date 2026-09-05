<template>
  <div>
    <div class="console-toolbar">
      <h2>团队管理</h2>
      <el-button type="primary" data-test="open-create-team" @click="createDialogVisible = true">
        新建团队
      </el-button>
    </div>

    <el-table :data="teams" data-test="teams-table" v-loading="loading">
      <el-table-column prop="name" label="团队名" />
      <el-table-column label="权限级别" width="120">
        <template #default="{ row }">{{ permissionText(row.permission) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag v-if="isDefaultTeam(row.name)" type="info" data-test="default-team-tag">默认团队</el-tag>
          <el-tag v-else-if="row.name === 'Owners'" type="warning" data-test="owners-team-tag">系统团队</el-tag>
          <el-tag v-else>自定义</el-tag>
        </template>
      </el-table-column>
      <el-table-column type="expand">
        <template #default="{ row }">
          <TeamMemberPanel :team="row" @changed="loadTeams" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button
            link
            type="danger"
            :data-test="`delete-team-${row.name}`"
            :disabled="isSystemTeam(row.name)"
            @click="confirmDeleteTeam(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />

    <el-dialog v-model="createDialogVisible" title="新建团队" width="420px">
      <el-form label-width="100px">
        <el-form-item label="团队名" required>
          <el-input v-model="newTeamName" data-test="new-team-name" placeholder="小写字母、数字与连字符" />
        </el-form-item>
        <el-form-item label="权限级别" required>
          <el-radio-group v-model="newTeamPermission" data-test="new-team-permission">
            <el-radio value="read">只读</el-radio>
            <el-radio value="write">读写</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="create-team-submit" @click="createTeam">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteDialogVisible" title="删除团队" width="420px">
      <p>确认删除团队 <strong>{{ deleteTargetName }}</strong>？成员将失去该团队的权限。</p>
      <template #footer>
        <el-button @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" data-test="delete-team-confirm" @click="deleteTeam">确认删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import TeamMemberPanel from '../../components/TeamMemberPanel.vue';

interface TeamView {
  id: number;
  name: string;
  permission: string;
}

const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers']);

// 系统团队 = 两个默认团队 + Owners(组织治理根基),均不可删除
function isSystemTeam(name: string): boolean {
  return DEFAULT_TEAM_NAMES.has(name) || name === 'Owners';
}

const teams = ref<TeamView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const createDialogVisible = ref(false);
const newTeamName = ref('');
const newTeamPermission = ref<'read' | 'write'>('read');

const deleteDialogVisible = ref(false);
const deleteTargetId = ref(0);
const deleteTargetName = ref('');

function isDefaultTeam(name: string): boolean {
  return DEFAULT_TEAM_NAMES.has(name);
}

function permissionText(permission: string): string {
  return permission === 'write' ? '读写' : permission === 'owner' || permission === 'admin' ? '管理' : '只读';
}

async function loadTeams(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    teams.value = await apiRequest<TeamView[]>('/api/orgs/teams');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function createTeam(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest('/api/orgs/teams', {
      method: 'POST',
      body: { name: newTeamName.value, permission: newTeamPermission.value }
    });
    createDialogVisible.value = false;
    newTeamName.value = '';
    newTeamPermission.value = 'read';
    ElMessage.success('团队已创建');
    await loadTeams();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function confirmDeleteTeam(team: TeamView): void {
  deleteTargetId.value = team.id;
  deleteTargetName.value = team.name;
  deleteDialogVisible.value = true;
}

async function deleteTeam(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/teams/${deleteTargetId.value}`, { method: 'DELETE' });
    deleteDialogVisible.value = false;
    ElMessage.success(`团队 ${deleteTargetName.value} 已删除`);
    await loadTeams();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(loadTeams);
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

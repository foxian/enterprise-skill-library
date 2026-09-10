<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">团队 {{ teams.length }} 个</span>
        <el-button type="primary" data-test="open-create-team" @click="createDialogVisible = true">
          新建团队
        </el-button>
      </div>

      <el-table :data="teams" data-test="teams-table" v-loading="loading">
      <el-table-column label="标识名" min-width="140">
        <template #default="{ row }">{{ row.name }}</template>
      </el-table-column>
      <el-table-column label="显示名" min-width="150">
        <template #default="{ row }">{{ row.display_name || '—' }}</template>
      </el-table-column>
      <el-table-column label="权限级别" width="100">
        <template #default="{ row }">{{ permissionText(row.permission) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag v-if="isSystemTeam(row.name)" type="info" data-test="default-team-tag">默认团队</el-tag>
          <el-tag v-else>自定义</el-tag>
        </template>
      </el-table-column>
      <el-table-column type="expand">
        <template #default="{ row }">
          <TeamMemberPanel :team="row" @changed="loadTeams" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :data-test="`edit-team-${row.name}`"
            :disabled="isSystemTeam(row.name)"
            @click="confirmEditTeam(row)"
          >
            编辑
          </el-button>
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
    </el-card>

    <el-dialog v-model="createDialogVisible" title="新建团队" width="460px">
      <el-form label-width="100px">
        <el-form-item label="标识名" required>
          <el-input v-model="newTeamName" data-test="new-team-name" placeholder="小写字母、数字与连字符" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input
            v-model="newTeamDisplayName"
            data-test="new-team-display-name"
            maxlength="64"
            placeholder="中文显示名，可留空"
          />
        </el-form-item>
        <el-form-item label="权限级别" required>
          <el-radio-group v-model="newTeamPermission" data-test="new-team-permission">
            <el-radio value="read">只读</el-radio>
            <el-radio value="write">读写</el-radio>
            <el-radio value="manage">管理</el-radio>
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

    <el-dialog v-model="editDialogVisible" title="编辑团队" width="460px">
      <el-form label-width="100px">
        <el-form-item label="权限级别" required>
          <el-radio-group v-model="editPermission" data-test="edit-team-permission">
            <el-radio value="read">只读</el-radio>
            <el-radio value="write">读写</el-radio>
            <el-radio value="manage">管理</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          v-if="editPermissionChanged"
          type="warning"
          :closable="false"
          show-icon
          class="permission-warning"
          title="调整权限级别会实时改变该团队在所有已授权技能上的访问级别，保存时需二次确认。"
        />
        <el-form-item label="标识名" required>
          <el-input v-model="editName" data-test="edit-team-name" placeholder="小写字母、数字与连字符" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input
            v-model="editDisplayName"
            data-test="edit-team-display-name"
            maxlength="64"
            placeholder="中文显示名，留空则清除"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="edit-team-confirm" @click="editTeam">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiRequest } from '../../api/client';
import TeamMemberPanel from '../../components/TeamMemberPanel.vue';

interface TeamView {
  id: number;
  name: string;
  permission: string;
  display_name?: string;
}

// ADR-0026 默认团队:服务端 /api/orgs/teams 已过滤三个全员团队与 Owners,
// 团队管理页只展示系统管理团队(唯一可增删成员的默认团队)与自定义团队。
// 系统管理团队不可编辑、不可删除(ADR-0029 编辑 = 标识名/权限/显示名三合一)。
const DEFAULT_TEAM_NAMES = new Set(['system-admins']);

function isSystemTeam(name: string): boolean {
  return DEFAULT_TEAM_NAMES.has(name);
}

function permissionText(permission: string): string {
  if (permission === 'manage' || permission === 'admin' || permission === 'owner') return '管理';
  return permission === 'write' ? '读写' : '只读';
}

const teams = ref<TeamView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const createDialogVisible = ref(false);
const newTeamName = ref('');
const newTeamDisplayName = ref('');
const newTeamPermission = ref<'read' | 'write' | 'manage'>('read');

const deleteDialogVisible = ref(false);
const deleteTargetId = ref(0);
const deleteTargetName = ref('');

const editDialogVisible = ref(false);
const editTargetId = ref(0);
const editName = ref('');
const editDisplayName = ref('');
const editPermission = ref<'read' | 'write' | 'manage'>('read');
const editOriginalPermission = ref<'read' | 'write' | 'manage'>('read');

// ADR-0029:权限档是跨技能联动开关——矩阵按团队当前权限实时派生,变更即改变
// 该团队挂载的所有技能上全体成员的访问级别。对话框内内联提示 + 保存时二次确认。
const editPermissionChanged = computed(() => editPermission.value !== editOriginalPermission.value);

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
      body: {
        name: newTeamName.value,
        permission: newTeamPermission.value,
        display_name: newTeamDisplayName.value
      }
    });
    createDialogVisible.value = false;
    newTeamName.value = '';
    newTeamDisplayName.value = '';
    newTeamPermission.value = 'read';
    ElMessage.success('团队已创建');
    await loadTeams();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function confirmDeleteTeam(team: TeamView): void {
  deleteTargetId.value = team.id;
  deleteTargetName.value = team.display_name || team.name;
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

// 编辑(ADR-0029):权限级别 + 标识名 + 显示名,一个对话框里改完。标识名按
// 团队 ID 引用,改名不断授权(ADR-0026);显示名只落 ESL DB。
function confirmEditTeam(team: TeamView): void {
  editTargetId.value = team.id;
  editName.value = team.name;
  editDisplayName.value = team.display_name ?? '';
  const level = normalizePermission(team.permission);
  editPermission.value = level;
  editOriginalPermission.value = level;
  editDialogVisible.value = true;
}

function normalizePermission(permission: string): 'read' | 'write' | 'manage' {
  if (permission === 'manage' || permission === 'admin' || permission === 'owner') return 'manage';
  return permission === 'write' ? 'write' : 'read';
}

async function editTeam(): Promise<void> {
  errorMessage.value = '';
  // 权限档变更:二次确认。服务端矩阵按团队当前权限实时派生,调高即静默越权
  // 方向,调低即静默降权方向,都要显式确认。
  if (editPermissionChanged.value) {
    try {
      await ElMessageBox.confirm(
        '权限级别变更会实时改变该团队在所有已授权技能上的访问级别，且不会逐技能提示。确认继续？',
        '权限级别变更',
        { type: 'warning', confirmButtonText: '确认变更', cancelButtonText: '取消' }
      );
    } catch {
      return;
    }
  }
  try {
    await apiRequest(`/api/orgs/teams/${editTargetId.value}`, {
      method: 'PATCH',
      body: {
        name: editName.value,
        permission: editPermission.value,
        display_name: editDisplayName.value
      }
    });
    editDialogVisible.value = false;
    ElMessage.success('团队已更新');
    await loadTeams();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(loadTeams);
</script>

<style scoped>
.toolbar-caption {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.page-error {
  margin-top: 16px;
}

.permission-warning {
  margin-bottom: 16px;
}
</style>

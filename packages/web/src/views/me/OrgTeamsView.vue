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
      <el-table-column label="类型" width="100">
        <template #default>
          <el-tag>自定义</el-tag>
        </template>
      </el-table-column>
      <el-table-column type="expand">
        <template #default="{ row }">
          <TeamMemberPanel :team="row" :org="org" @changed="loadTeams" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button link type="primary" :data-test="`edit-team-${row.name}`" @click="confirmEditTeam(row)">
            编辑
          </el-button>
          <el-button link type="danger" :data-test="`delete-team-${row.name}`" @click="confirmDeleteTeam(row)">
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
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import TeamMemberPanel from '../../components/TeamMemberPanel.vue';

// 组织由路由显式指名（ADR-0035），不再是会话里的隐式"当前组织"。
const route = useRoute();
const org = computed<string>(() => String(route.params.org ?? ''));

interface TeamView {
  id: number;
  name: string;
  display_name?: string;
}

// 常设团队（含组织管理团队）由服务端从 /api/orgs/:org/teams 过滤掉，此页只
// 展示自定义团队——因此没有"默认团队"分支，也不做前端的可变保护判断。
const teams = ref<TeamView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const createDialogVisible = ref(false);
const newTeamName = ref('');
const newTeamDisplayName = ref('');

const deleteDialogVisible = ref(false);
const deleteTargetId = ref(0);
const deleteTargetName = ref('');

const editDialogVisible = ref(false);
const editTargetId = ref(0);
const editName = ref('');
const editDisplayName = ref('');

async function loadTeams(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    teams.value = await apiRequest<TeamView[]>(`/api/orgs/${org.value}/teams`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function createTeam(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/teams`, {
      method: 'POST',
      body: {
        name: newTeamName.value,
        display_name: newTeamDisplayName.value
      }
    });
    createDialogVisible.value = false;
    newTeamName.value = '';
    newTeamDisplayName.value = '';
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
    await apiRequest(`/api/orgs/${org.value}/teams/${deleteTargetId.value}`, { method: 'DELETE' });
    deleteDialogVisible.value = false;
    ElMessage.success(`团队 ${deleteTargetName.value} 已删除`);
    await loadTeams();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

// 编辑(ADR-0029):标识名 + 显示名,一个对话框里改完。标识名按团队 ID
// 引用,改名不断授权(ADR-0026);显示名只落 ESL DB。
async function confirmEditTeam(team: TeamView): Promise<void> {
  editTargetId.value = team.id;
  editName.value = team.name;
  editDisplayName.value = team.display_name ?? '';
  editDialogVisible.value = true;
}

async function editTeam(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${org.value}/teams/${editTargetId.value}`, {
      method: 'PATCH',
      body: {
        name: editName.value,
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

</style>

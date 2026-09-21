<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">{{ t('team.count', { count: teams.length }) }}</span>
        <el-button type="primary" data-test="open-create-team" @click="createDialogVisible = true">
          {{ t('team.createTitle') }}
        </el-button>
      </div>

      <el-table :data="teams" data-test="teams-table" v-loading="loading">
      <el-table-column :label="t('columns.identifier')" min-width="140">
        <template #default="{ row }">{{ row.name }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.displayName')" min-width="150">
        <template #default="{ row }">{{ row.display_name || '—' }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.type')" width="100">
        <template #default>
          <el-tag>{{ t('team.custom') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column type="expand">
        <template #default="{ row }">
          <TeamMemberPanel :team="row" :org="org" @changed="loadTeams" />
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.actions')" width="140">
        <template #default="{ row }">
          <el-button link type="primary" :data-test="`edit-team-${row.name}`" @click="confirmEditTeam(row)">
            {{ t('actions.edit') }}
          </el-button>
          <el-button link type="danger" :data-test="`delete-team-${row.name}`" @click="confirmDeleteTeam(row)">
            {{ t('actions.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="createDialogVisible" :title="t('team.createTitle')" width="460px">
      <el-form label-width="100px">
        <el-form-item :label="t('columns.identifier')" required>
          <el-input v-model="newTeamName" data-test="new-team-name" :placeholder="t('organization.orgNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('columns.displayName')">
          <el-input
            v-model="newTeamDisplayName"
            data-test="new-team-display-name"
            maxlength="64"
            :placeholder="t('team.displayNamePlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" data-test="create-team-submit" @click="createTeam">{{ t('actions.create') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteDialogVisible" :title="t('team.deleteTitle')" width="420px">
      <p>{{ t('team.deleteWarning', { team: deleteTargetName }) }}</p>
      <template #footer>
        <el-button @click="deleteDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="danger" data-test="delete-team-confirm" @click="deleteTeam">{{ t('actions.confirmDelete') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" :title="t('team.editTitle')" width="460px">
      <el-form label-width="100px">
        <el-form-item :label="t('columns.identifier')" required>
          <el-input v-model="editName" data-test="edit-team-name" :placeholder="t('organization.orgNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('columns.displayName')">
          <el-input
            v-model="editDisplayName"
            data-test="edit-team-display-name"
            maxlength="64"
            :placeholder="t('team.displayNameClearPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" data-test="edit-team-confirm" @click="editTeam">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';
import TeamMemberPanel from '../../components/TeamMemberPanel.vue';

const { t } = useLocaleState();

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
    errorMessage.value = formatRequestError(error);
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
    ElMessage.success(t('team.created'));
    await loadTeams();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    ElMessage.success(t('team.deleted', { team: deleteTargetName.value }));
    await loadTeams();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    ElMessage.success(t('team.updated'));
    await loadTeams();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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

<template>
  <div class="team-member-panel">
    <div class="console-toolbar">
      <span>{{ t('team.title') }}</span>
      <div class="add-member">
        <el-input v-model="username" data-test="team-add-username" :placeholder="t('skill.memberUsernamePlaceholder')" style="width: 200px" />
        <el-button type="primary" data-test="team-add-submit" @click="addMember">{{ t('actions.addMember') }}</el-button>
      </div>
    </div>
    <el-table :data="members" size="small" :data-test="`team-members-${team.name}`">
      <el-table-column :label="t('columns.member')">
        <template #default="{ row }">{{ row.username }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.actions')" width="100">
        <template #default="{ row }">
          <el-button
            link
            type="danger"
            :data-test="`team-remove-${row.username}`"
            @click="removeMember(row)"
          >
            {{ t('actions.remove') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../i18n/locale';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../api/client';

const { t } = useLocaleState();

interface TeamView {
  id: number;
  name: string;
}

interface GiteaUserView {
  id: number;
  username: string;
  email: string;
}

// org 由父组件（组织控制台路由上下文）提供；成员为全局账号（ADR-0032）。
const props = defineProps<{ team: TeamView; org: string }>();
const emit = defineEmits<{ (event: 'changed'): void }>();

const username = ref('');
const members = ref<GiteaUserView[]>([]);
const errorMessage = ref('');

async function loadMembers(): Promise<void> {
  errorMessage.value = '';
  try {
    members.value = await apiRequest<GiteaUserView[]>(`/api/orgs/${props.org}/teams/${props.team.id}/members`);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${props.org}/teams/${props.team.id}/members`, {
      method: 'POST',
      body: { username: username.value }
    });
    username.value = '';
    ElMessage.success(t('team.memberJoined'));
    await loadMembers();
    emit('changed');
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function removeMember(member: GiteaUserView): Promise<void> {
  errorMessage.value = '';
  try {
    // Owners 成员由服务端拒绝移出（治理兜底），前端不做重复推断
    await apiRequest(`/api/orgs/${props.org}/teams/${props.team.id}/members/${encodeURIComponent(member.username)}`, {
      method: 'DELETE'
    });
    ElMessage.success(t('team.memberRemoved', { member: member.username }));
    await loadMembers();
    emit('changed');
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

onMounted(loadMembers);
</script>

<style scoped>
.team-member-panel {
  padding: 8px 16px;
}

.add-member {
  display: flex;
  gap: 8px;
}
</style>

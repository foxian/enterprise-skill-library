<template>
  <div class="team-member-panel">
    <div class="console-toolbar">
      <span>团队成员</span>
      <div class="add-member">
        <el-input v-model="username" data-test="team-add-username" placeholder="成员用户名" style="width: 200px" />
        <el-button type="primary" data-test="team-add-submit" @click="addMember">添加成员</el-button>
      </div>
    </div>
    <el-table :data="members" size="small" :data-test="`team-members-${team.name}`">
      <el-table-column prop="username" label="用户名" />
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button link type="danger" :data-test="`team-remove-${row.username}`" @click="removeMember(row)">
            移除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface TeamView {
  id: number;
  name: string;
  permission: string;
}

interface GiteaUserView {
  id: number;
  username: string;
  email: string;
}

const props = defineProps<{ team: TeamView }>();
const emit = defineEmits<{ (event: 'changed'): void }>();
const auth = useAuthStore();

function shortUsername(username: string): string {
  return username.startsWith(`${auth.org}_`) ? username.slice(auth.org!.length + 1) : username;
}

const username = ref('');
const members = ref<GiteaUserView[]>([]);
const errorMessage = ref('');

async function loadMembers(): Promise<void> {
  errorMessage.value = '';
  try {
    members.value = await apiRequest<GiteaUserView[]>(`/api/orgs/teams/${props.team.id}/members`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/teams/${props.team.id}/members`, {
      method: 'POST',
      body: { username: username.value }
    });
    username.value = '';
    ElMessage.success('成员已加入团队');
    await loadMembers();
    emit('changed');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function removeMember(member: GiteaUserView): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/teams/${props.team.id}/members/${encodeURIComponent(shortUsername(member.username))}`, {
      method: 'DELETE'
    });
    ElMessage.success(`已移除 ${member.username}`);
    await loadMembers();
    emit('changed');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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

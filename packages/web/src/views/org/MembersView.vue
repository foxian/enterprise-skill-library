<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <div class="toolbar-end">
          <el-button type="primary" data-test="open-add-member" @click="addDialogVisible = true">添加成员</el-button>
        </div>
      </div>

      <el-table :data="members" data-test="members-table" v-loading="loading">
        <el-table-column label="成员">
          <template #default="{ row }">{{ row.username }}</template>
        </el-table-column>
        <el-table-column label="身份" width="120">
          <template #default>
            <el-tag type="success" data-test="member-status">成员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <!-- Owners 成员由服务端拒绝移出（治理兜底），前端不重复推断 -->
            <el-button link type="danger" :data-test="`remove-${row.username}`" @click="openRemove(row)">
              移出
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

    <el-dialog v-model="addDialogVisible" title="添加成员" width="420px">
      <p v-if="inviteMode" class="invite-hint">当前平台为邀请制：对方接受邀请后才会加入组织。</p>
      <el-form label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="addUsername" data-test="add-member-username" placeholder="对方的全局账号用户名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="add-member-submit" @click="addMember">
          {{ inviteMode ? '发送邀请' : '添加' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="removeDialogVisible" title="移出成员" width="420px">
      <p>
        移出后 <strong>{{ removeTarget }}</strong> 将离开组织并自动从只读、读写、技能管理团队移除。确认继续？
      </p>
      <template #footer>
        <el-button @click="removeDialogVisible = false">取消</el-button>
        <el-button type="danger" data-test="remove-member-confirm" @click="removeMember">确认移出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../../stores/auth';
import { apiRequest } from '../../api/client';

interface GiteaUserView {
  id: number;
  username: string;
  email: string;
}

const auth = useAuthStore();
const members = ref<GiteaUserView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

const addDialogVisible = ref(false);
const addUsername = ref('');

const removeDialogVisible = ref(false);
const removeTarget = ref('');

// 平台信息：邀请制下前端把按钮文案改为发送邀请（行为由服务端按设置决定）
const inviteMode = computed(() => platformInfo.value?.memberAddMode === 'invite');
const platformInfo = ref<{ memberAddMode?: 'direct' | 'invite' } | null>(null);

async function loadMembers(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    members.value = await apiRequest<GiteaUserView[]>(`/api/orgs/${auth.org}/members`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  if (!addUsername.value.trim()) {
    errorMessage.value = '请输入用户名';
    return;
  }
  try {
    const result = await apiRequest<{ status: string; username: string }>(
      `/api/orgs/${auth.org}/members`,
      {
        method: 'POST',
        body: { username: addUsername.value.trim() }
      }
    );
    addDialogVisible.value = false;
    addUsername.value = '';
    if (result.status === 'invited') {
      ElMessage.success(`已向 ${result.username} 发送入组邀请`);
    } else {
      ElMessage.success(`成员 ${result.username} 已加入组织`);
    }
    await loadMembers();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openRemove(row: GiteaUserView): void {
  removeTarget.value = row.username;
  removeDialogVisible.value = true;
}

async function removeMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/${auth.org}/members/${encodeURIComponent(removeTarget.value)}`, {
      method: 'DELETE'
    });
    removeDialogVisible.value = false;
    ElMessage.success(`成员 ${removeTarget.value} 已移出组织`);
    await loadMembers();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(async () => {
  void loadMembers();
  try {
    platformInfo.value = await apiRequest('/api/public/platform-info');
  } catch {
    platformInfo.value = null;
  }
});
</script>

<style scoped>
.toolbar-end {
  margin-left: auto;
}

.page-error {
  margin-top: 16px;
}

.invite-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}
</style>

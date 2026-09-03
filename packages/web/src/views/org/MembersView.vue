<template>
  <div>
    <div class="console-toolbar">
      <h2>成员管理</h2>
      <div>
        <el-button data-test="open-enable-member" @click="enableDialogVisible = true">启用成员</el-button>
        <el-button type="primary" data-test="open-add-member" @click="addDialogVisible = true">添加成员</el-button>
      </div>
    </div>

    <el-table :data="members" data-test="members-table" v-loading="loading">
      <el-table-column prop="username" label="用户名" />
      <el-table-column label="显示名" width="160">
        <template #default="{ row }">{{ displayName(row.username) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default>
          <el-tag type="success" data-test="member-status">在册</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" :data-test="`reset-password-${row.username}`" @click="openReset(row)">
            重置密码
          </el-button>
          <el-button link type="danger" :data-test="`disable-${row.username}`" @click="openDisable(row)">
            禁用
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />

    <el-dialog v-model="addDialogVisible" title="添加成员" width="420px">
      <el-form label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="addUsername" data-test="add-member-username" placeholder="小写字母、数字与连字符" />
        </el-form-item>
        <el-form-item label="初始密码">
          <el-input v-model="addPassword" data-test="add-member-password" placeholder="留空自动生成" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="add-member-submit" @click="addMember">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetDialogVisible" :title="`重置密码：${resetTarget}`" width="420px">
      <el-form label-width="100px">
        <el-form-item label="新密码">
          <el-input v-model="resetPassword" data-test="reset-password-input" placeholder="留空自动生成" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="reset-password-submit" @click="resetPasswordFor">重置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="disableDialogVisible" title="禁用成员" width="420px">
      <p>禁用后 <strong>{{ disableTarget }}</strong> 将被移出组织全部团队并无法登录。确认继续？</p>
      <template #footer>
        <el-button @click="disableDialogVisible = false">取消</el-button>
        <el-button type="danger" data-test="disable-member-confirm" @click="disableMember">确认禁用</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="enableDialogVisible" title="启用成员" width="420px">
      <p>输入被禁用成员的用户名，恢复其登录并重新加入默认团队。</p>
      <el-input v-model="enableUsername" data-test="enable-member-username" placeholder="成员用户名（不含组织前缀）" />
      <template #footer>
        <el-button @click="enableDialogVisible = false">取消</el-button>
        <el-button type="primary" data-test="enable-member-submit" @click="enableMember">启用</el-button>
      </template>
    </el-dialog>

    <!-- 一次性密码展示：关闭后不再可见 -->
    <el-dialog v-model="passwordDialogVisible" title="一次性初始密码" width="420px">
      <p><strong>{{ passwordDialogUsername }}</strong> 的初始密码（仅展示一次，请立即交付）：</p>
      <el-input :model-value="oneTimePassword" readonly data-test="one-time-password" />
      <template #footer>
        <el-button type="primary" data-test="one-time-password-close" @click="passwordDialogVisible = false">
          我已保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validateMemberUsername, validatePassword } from '@esl/core/dist/org/account-policy.js';
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
const addPassword = ref('');

const resetDialogVisible = ref(false);
const resetTarget = ref('');
const resetPassword = ref('');

const disableDialogVisible = ref(false);
const disableTarget = ref('');

const enableDialogVisible = ref(false);
const enableUsername = ref('');

const passwordDialogVisible = ref(false);
const passwordDialogUsername = ref('');
const oneTimePassword = ref('');

function displayName(username: string): string {
  return username.startsWith(`${auth.org}_`) ? username.slice(auth.org!.length + 1) : username;
}

function shortUsername(username: string): string {
  return displayName(username);
}

async function loadMembers(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    members.value = await apiRequest<GiteaUserView[]>('/api/orgs/members');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function addMember(): Promise<void> {
  errorMessage.value = '';
  // 与服务端复用同一核心校验规则:成员用户名与可选的初始密码
  const usernameValidation = validateMemberUsername(addUsername.value);
  if (!usernameValidation.success) {
    errorMessage.value = usernameValidation.errors.join('；');
    return;
  }
  if (addPassword.value) {
    const passwordValidation = validatePassword(addPassword.value);
    if (!passwordValidation.success) {
      errorMessage.value = passwordValidation.errors.join('；');
      return;
    }
  }
  try {
    const result = await apiRequest<{ username: string; password?: string }>('/api/orgs/members', {
      method: 'POST',
      body: { username: addUsername.value, password: addPassword.value || undefined }
    });
    addDialogVisible.value = false;
    addUsername.value = '';
    addPassword.value = '';
    if (result.password) {
      passwordDialogUsername.value = result.username;
      oneTimePassword.value = result.password;
      passwordDialogVisible.value = true;
    } else {
      ElMessage.success(`成员 ${result.username} 已添加`);
    }
    await loadMembers();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openReset(row: GiteaUserView): void {
  resetTarget.value = row.username;
  resetPassword.value = '';
  resetDialogVisible.value = true;
}

async function resetPasswordFor(): Promise<void> {
  errorMessage.value = '';
  if (resetPassword.value) {
    const passwordValidation = validatePassword(resetPassword.value);
    if (!passwordValidation.success) {
      errorMessage.value = passwordValidation.errors.join('；');
      return;
    }
  }
  try {
    const result = await apiRequest<{ username: string; password?: string }>(
      `/api/orgs/members/${encodeURIComponent(shortUsername(resetTarget.value))}/password`,
      {
        method: 'POST',
        body: { password: resetPassword.value || undefined }
      }
    );
    resetDialogVisible.value = false;
    if (result.password) {
      passwordDialogUsername.value = result.username;
      oneTimePassword.value = result.password;
      passwordDialogVisible.value = true;
    } else {
      ElMessage.success(`已重置 ${result.username} 的密码`);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openDisable(row: GiteaUserView): void {
  disableTarget.value = row.username;
  disableDialogVisible.value = true;
}

async function disableMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/members/${encodeURIComponent(shortUsername(disableTarget.value))}/disable`, {
      method: 'POST'
    });
    disableDialogVisible.value = false;
    ElMessage.success(`成员 ${disableTarget.value} 已禁用`);
    await loadMembers();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function enableMember(): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/orgs/members/${encodeURIComponent(enableUsername.value)}/enable`, {
      method: 'POST'
    });
    enableDialogVisible.value = false;
    enableUsername.value = '';
    ElMessage.success('成员已启用');
    await loadMembers();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(loadMembers);
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

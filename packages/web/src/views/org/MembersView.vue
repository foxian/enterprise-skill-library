<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">在册成员 {{ members.length }} 人</span>
        <div>
          <el-button type="primary" data-test="open-add-member" @click="addDialogVisible = true">添加成员</el-button>
        </div>
      </div>

      <el-tabs v-model="activeTab">
      <el-tab-pane label="在册成员" name="members">
        <el-table :data="members" data-test="members-table" v-loading="loading">
          <el-table-column label="成员">
            <template #default="{ row }">{{ shortUsername(auth.org, row.username) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default>
              <el-tag type="success" data-test="member-status">在册</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <el-button link type="primary" :data-test="`reset-password-${row.username}`" @click="openReset(row)">
                重置密码
              </el-button>
              <el-button
                v-if="!isOrganizationAdmin(row.username)"
                link
                type="danger"
                :data-test="`disable-${row.username}`"
                @click="openDisable(row)"
              >
                禁用
              </el-button>
              <!-- 组织管理员是组织唯一 Owner 与治理入口,不可被禁用(后端同样拒绝) -->
              <el-tag v-else type="warning" data-test="admin-badge">管理员</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <!-- 被禁用成员已被移出组织,单独一个 tab;只有存在禁用成员时才显示 -->
      <el-tab-pane v-if="disabledMembers.length" :label="`已禁用（${disabledMembers.length}）`" name="disabled" data-test="disabled-members-tab">
        <el-table :data="disabledMembers" size="small" data-test="disabled-members-table">
          <el-table-column label="成员">
            <template #default="{ row }">{{ shortUsername(auth.org, row.username) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :data-test="`enable-${row.username}`"
                :loading="enabling === row.username"
                @click="enableDisabled(row)"
              >
                启用
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>

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
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { validateMemberUsername, validatePassword } from '@esl/core/dist/org/account-policy.js';
import { useAuthStore } from '../../stores/auth';
import { apiRequest, openOperationStream, type OperationStream } from '../../api/client';
import { shortUsername } from '../../utils/short-username';

interface GiteaUserView {
  id: number;
  username: string;
  email: string;
}

const auth = useAuthStore();
const members = ref<GiteaUserView[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const activeTab = ref('members');

const addDialogVisible = ref(false);
const addUsername = ref('');
const addPassword = ref('');

const resetDialogVisible = ref(false);
const resetTarget = ref('');
const resetPassword = ref('');

const disableDialogVisible = ref(false);
const disableTarget = ref('');

const disabledMembers = ref<GiteaUserView[]>([]);
const enabling = ref('');

const passwordDialogVisible = ref(false);
const passwordDialogUsername = ref('');
const oneTimePassword = ref('');

// 成员创建是异步 Operation:订阅状态流,创建完成后再刷新列表
let operationStream: OperationStream | undefined;

onUnmounted(() => {
  operationStream?.close();
  operationStream = undefined;
});

function isOrganizationAdmin(username: string): boolean {
  return username === `${auth.org}_admin`;
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

async function loadDisabledMembers(): Promise<void> {
  errorMessage.value = '';
  try {
    disabledMembers.value = await apiRequest<GiteaUserView[]>('/api/orgs/members/disabled');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
    const result = await apiRequest<{ username: string; password?: string; operationId?: number }>('/api/orgs/members', {
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
    if (result.operationId) {
      // 成员创建是异步 Operation:订阅状态流,创建完成后再刷新列表,避免读到
      // Gitea 尚未建好用户的中间状态。
      operationStream = openOperationStream(result.operationId, {
        onEvent: (event) => {
          if (event.status === 'succeeded') {
            void loadMembers();
          } else if (event.status === 'permanently_failed') {
            errorMessage.value = '成员创建失败，请稍后重试';
          }
        },
        onError: () => {
          // 流断开时兜底刷新,不阻断后续操作
          void loadMembers();
        }
      });
    } else {
      await loadMembers();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openReset(row: GiteaUserView): void {
  // 对话框标题展示短名;API 路径使用短名(后端在组织上下文拼装完整用户名)
  resetTarget.value = shortUsername(auth.org, row.username);
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
      `/api/orgs/members/${encodeURIComponent(resetTarget.value)}/password`,
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
  // 对话框与提示展示短名;API 路径使用短名(后端在组织上下文拼装完整用户名)
  disableTarget.value = shortUsername(auth.org, row.username);
  disableDialogVisible.value = true;
}

async function disableMember(): Promise<void> {
  errorMessage.value = '';
  try {
    const result = await apiRequest<{ username: string; operationId?: number }>(
      `/api/orgs/members/${encodeURIComponent(disableTarget.value)}/disable`,
      { method: 'POST' }
    );
    disableDialogVisible.value = false;
    ElMessage.success(`成员 ${disableTarget.value} 已禁用`);
    if (result.operationId) {
      // 禁用是异步 Operation:订阅状态流,成功后再同时刷新在册与已禁用列表
      operationStream = openOperationStream(result.operationId, {
        onEvent: (event) => {
          if (event.status === 'succeeded') {
            void loadMembers();
            void loadDisabledMembers();
          } else if (event.status === 'permanently_failed') {
            errorMessage.value = '成员禁用失败，请稍后重试';
          }
        },
        onError: () => {
          void loadMembers();
          void loadDisabledMembers();
        }
      });
    } else {
      await loadMembers();
      await loadDisabledMembers();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function enableDisabled(row: GiteaUserView): Promise<void> {
  errorMessage.value = '';
  enabling.value = row.username;
  try {
    const result = await apiRequest<{ username: string; operationId?: number }>(
      `/api/orgs/members/${encodeURIComponent(shortUsername(auth.org, row.username))}/enable`,
      { method: 'POST' }
    );
    ElMessage.success(`成员 ${shortUsername(auth.org, row.username)} 已启用`);
    if (result.operationId) {
      // 启用是异步 Operation:订阅状态流,完成后刷新在册与被禁用列表
      operationStream = openOperationStream(result.operationId, {
        onEvent: (event) => {
          if (event.status === 'succeeded') {
            void loadMembers();
            void loadDisabledMembers();
          } else if (event.status === 'permanently_failed') {
            errorMessage.value = '成员启用失败，请稍后重试';
          }
        },
        onError: () => {
          void loadMembers();
          void loadDisabledMembers();
        }
      });
    } else {
      await loadMembers();
      await loadDisabledMembers();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    enabling.value = '';
  }
}

onMounted(() => {
  void loadMembers();
  void loadDisabledMembers();
});
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

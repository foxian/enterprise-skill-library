<template>
  <div data-test="skill-manage-panel">
    <div class="console-toolbar">
      <h2 class="panel-title">
        技能管理：<code class="skill-path">@{{ scope }}/{{ skillName }}</code>
      </h2>
      <el-tag :type="stateTagType" data-test="share-state">{{ stateText }}</el-tag>
    </div>

    <el-card class="section-card" data-test="skill-context-card">
      <template #header>技能信息</template>
      <div class="skill-context">
        <div class="skill-desc-row">
          <span v-if="context?.description" data-test="skill-description">{{ context.description }}</span>
          <span v-else class="context-empty" data-test="skill-description">暂无描述</span>
        </div>
        <el-space wrap class="skill-meta-row">
          <el-tag :type="contextStatusType" size="small" data-test="skill-context-status">{{ contextStatusText }}</el-tag>
          <span v-if="context?.latestRelease" class="skill-meta" data-test="skill-latest-release">
            最新发布
            <code class="skill-version">v{{ context.latestRelease.version }}</code>
            <template v-if="context.latestRelease.createdAt">（{{ formatDate(context.latestRelease.createdAt) }}）</template>
          </span>
          <span v-else class="skill-meta" data-test="skill-latest-release">尚未发布任何 Skill Release</span>
          <span v-if="context?.createdBy" class="skill-meta">创建者：{{ shortUsername(props.scope, context.createdBy) }}</span>
        </el-space>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>当前共享状态</template>
      <el-space wrap>
        <el-tag v-if="matrix.sharedAllManage" type="danger">全员管理</el-tag>
        <el-tag v-if="matrix.sharedAllWrite" type="warning">全员读写</el-tag>
        <el-tag v-if="matrix.sharedAllRead" type="success">全员只读</el-tag>
        <el-tag v-for="team in matrix.teams" :key="team.id" data-test="granted-team">
          团队 {{ teamDisplayName(team) }}（{{ permissionText(team.permission) }}）
        </el-tag>
        <el-tag v-for="member in matrix.members" :key="member.username" type="info" data-test="granted-member">
          {{ shortUsername(props.scope, member.username) }}（{{ permissionText(member.permission) }}）
        </el-tag>
      </el-space>
    </el-card>

    <el-card v-if="(context?.releases?.length ?? 0) > 0" class="section-card" data-test="release-history-card">
      <template #header>发布历史（{{ context!.releases.length }}）</template>
      <el-collapse>
        <el-collapse-item title="展开全部 Skill Release">
          <el-table :data="context!.releases" size="small" data-test="release-history-table">
            <el-table-column label="版本" width="90">
              <template #default="{ row }">
                <code class="skill-version">v{{ row.version }}</code>
              </template>
            </el-table-column>
            <el-table-column label="发布时间" width="170">
              <template #default="{ row }">{{ row.createdAt ? formatDate(row.createdAt) : '—' }}</template>
            </el-table-column>
            <el-table-column label="发布说明">
              <template #default="{ row }">{{ row.notes || '—' }}</template>
            </el-table-column>
            <el-table-column label="来源 commit" width="120">
              <template #default="{ row }">
                <code class="skill-version">{{ shortCommit(row.sourceCommit) }}</code>
              </template>
            </el-table-column>
            <el-table-column label="发布人" width="120">
              <template #default="{ row }">{{ shortUsername(props.scope, row.createdBy) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button
                  link
                  type="danger"
                  :data-test="`delete-release-${row.version}`"
                  @click="deleteRelease(row.version)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-card class="section-card">
      <template #header>组织共享级别</template>
      <el-radio-group :model-value="shareLevel" data-test="share-level" @change="onShareLevelChange">
        <el-radio value="none">不共享（私有）</el-radio>
        <el-radio value="read">全员只读</el-radio>
        <el-radio value="write">全员读写</el-radio>
        <el-radio value="manage">全员管理</el-radio>
      </el-radio-group>
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
            <el-table-column label="团队">
              <template #default="{ row }">{{ teamDisplayName(row) }}</template>
            </el-table-column>
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
              <el-option
                v-for="member in memberOptions"
                :key="member.username"
                :label="shortUsername(props.scope, member.username)"
                :value="member.username"
              />
            </el-select>
            <el-input v-else v-model="selectedMember" data-test="member-input" placeholder="成员用户名（含组织前缀）" style="width: 220px" />
            <el-select v-model="memberPermission" data-test="member-permission" style="width: 110px">
              <el-option label="只读" value="read" />
              <el-option label="读写" value="write" />
              <el-option label="管理" value="manage" />
            </el-select>
            <el-button type="primary" data-test="grant-member" @click="grantMember">添加授权</el-button>
          </div>
          <el-table v-if="matrix.members.length" :data="matrix.members" size="small">
            <el-table-column label="成员">
              <template #default="{ row }">{{ shortUsername(props.scope, row.username) }}</template>
            </el-table-column>
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiRequest } from '../api/client';
import { shortUsername } from '../utils/short-username';
import {
  deriveShareState,
  statusText,
  type MemberOption,
  type PermissionMatrix,
  type PermissionsResponse,
  type SkillContext,
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
  sharedAllManage: false,
  teams: [],
  members: []
});
const context = ref<SkillContext | undefined>();
const errorMessage = ref('');

const selectedTeam = ref('');
const selectedMember = ref('');
const memberPermission = ref<'read' | 'write' | 'manage'>('read');

// 组织管理员提供团队/成员下拉建议；普通成员视角退化为手工输入
const teamOptions = computed(() => props.teamOptions ?? []);
const memberOptions = computed(() => props.memberOptions ?? []);

const shareState = computed(() => deriveShareState(matrix.value));

const stateText = computed(() => shareState.value.text);

const stateTagType = computed(() => shareState.value.tagType);

// 组织共享级别(ADR-0026):由共享状态推导当前单选档位
const shareLevel = computed<'none' | 'read' | 'write' | 'manage'>(() => {
  if (matrix.value.sharedAllManage) return 'manage';
  if (matrix.value.sharedAllWrite) return 'write';
  if (matrix.value.sharedAllRead) return 'read';
  return 'none';
});

const SHARE_LEVEL_ACTIONS: Record<string, string> = {
  none: 'reset_to_private',
  read: 'share_all_read',
  write: 'share_all_write',
  manage: 'share_all_manage'
};

async function onShareLevelChange(level: string | number | boolean | undefined): Promise<void> {
  const action = SHARE_LEVEL_ACTIONS[String(level)];
  if (action) await applyAction(action);
}

// ADR-0025 三档:manage 档(Gitea admin 级)呈现为「管理」
function permissionText(permission: string): string {
  if (permission === 'manage' || permission === 'admin' || permission === 'owner') return '管理';
  return permission === 'write' ? '读写' : '只读';
}

function teamLabel(team: TeamOption): string {
  return `${teamDisplayName(team)}（${permissionText(team.permission)}）`;
}

// ADR-0029:界面优先展示团队显示名(允许中文),未设置回退标识名。
// 授权 value 与 remove_team 请求体仍用标识名(team.name)。
function teamDisplayName(team: { name: string; display_name?: string }): string {
  return team.display_name || team.name;
}

// 上下文状态与列表页 statusText 一致,但已归档是明确的终态,如实单列
const contextStatusText = computed(() => {
  const status = context.value?.status;
  if (status === 'archived') return '已归档';
  return statusText(status);
});

const contextStatusType = computed<'success' | 'warning'>(() => (context.value?.status === 'archived' ? 'warning' : 'success'));

function formatDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

// Release Tag 指向的 commit 以短 SHA 展示
function shortCommit(commit: string): string {
  return commit.length > 8 ? commit.slice(0, 8) : commit;
}

async function loadMatrix(): Promise<void> {
  errorMessage.value = '';
  try {
    await assignPermissionsResponse(
      await apiRequest<PermissionsResponse>(
        `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/permissions`
      )
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

// permissions 响应聘带只读技能上下文,统一在此拆分:矩阵进 matrix,skill 块进 context
function assignPermissionsResponse(response: PermissionsResponse): void {
  const { skill, ...matrixResponse } = response;
  context.value = skill;
  matrix.value = matrixResponse;
}

// 单版本删除(CONTEXT:单版本删除):不可变发布模型下的外科手术式清理。服务端以
// 「confirm 必须等于版本号」表达显式确认,这里用输入框承载;依赖引用等守卫由服务端
// 判定,拒绝原因(含引用方)原样呈现,不在这里替用户做取舍。
async function deleteRelease(version: string): Promise<void> {
  errorMessage.value = '';
  let answer: string;
  try {
    const result = await ElMessageBox.prompt(
      `删除 v${version} 会移除该版本的发布包、版本记录与 Release Tag（源码 Git 历史与其他版本保留），且该版本号不可再发布。请输入 ${version} 确认：`,
      '删除 Skill Release',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        inputPlaceholder: version,
        type: 'warning'
      }
    );
    answer = result.value ?? '';
  } catch {
    return; // 用户取消
  }
  if (answer.trim() !== version) {
    errorMessage.value = `确认失败：请输入完整版本号 ${version}`;
    return;
  }

  try {
    await apiRequest(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}` +
        `/releases/${encodeURIComponent(version)}/delete`,
      { method: 'POST', body: { confirm: version } }
    );
    ElMessage.success(`已删除 v${version}`);
    await loadMatrix();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

// 返回操作是否成功，便于调用方决定是否清空输入并提示成功
async function applyAction(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  errorMessage.value = '';
  try {
    // 每次操作返回最新权限矩阵，直接刷新页面状态
    await assignPermissionsResponse(
      await apiRequest<PermissionsResponse>(
        `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/permissions`,
        { method: 'POST', body: { action, ...extra } }
      )
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
.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 技能标识符是技术坐标,用等宽字体呈现 */
.skill-path {
  font-family: var(--font-family-mono);
  font-size: 14px;
  color: var(--celadon-600);
  background-color: var(--celadon-50);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.skill-version {
  font-family: var(--font-family-mono);
  color: var(--celadon-600);
}

.skill-context {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-desc-row {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.context-empty {
  color: var(--el-text-color-secondary);
}

.skill-meta-row {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.skill-meta {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}

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

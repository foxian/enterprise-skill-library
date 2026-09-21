<template>
  <div data-test="skill-manage-panel">
    <div class="console-toolbar">
      <h2 class="panel-title">
        {{ t('skill.manageTitlePrefix') }}<code class="skill-path">@{{ scope }}/{{ skillName }}</code>
      </h2>
      <el-tag :type="stateTagType" data-test="share-state">{{ stateText }}</el-tag>
    </div>

    <el-card class="section-card" data-test="skill-context-card">
      <template #header>{{ t('skill.info') }}</template>
      <div class="skill-context">
        <div class="skill-desc-row">
          <span v-if="context?.description" data-test="skill-description">{{ context.description }}</span>
          <span v-else class="context-empty" data-test="skill-description">{{ t('skill.noDescription') }}</span>
        </div>
        <el-space wrap class="skill-meta-row">
          <el-tag :type="contextStatusType" size="small" data-test="skill-context-status">{{ contextStatusText }}</el-tag>
          <span v-if="context?.latestRelease" class="skill-meta" data-test="skill-latest-release">
            {{ t('skill.latestRelease') }}
            <code class="skill-version">v{{ context.latestRelease.version }}</code>
            <template v-if="context.latestRelease.createdAt">（{{ formatDate(context.latestRelease.createdAt) }}）</template>
          </span>
          <span v-else class="skill-meta" data-test="skill-latest-release">{{ t('skill.noReleases') }}</span>
          <span v-if="context?.createdBy" class="skill-meta">
            {{ t('skill.createdByUser', { name: shortUsername(props.scope, context.createdBy) }) }}
          </span>
        </el-space>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>{{ t('skill.currentShare') }}</template>
      <el-space wrap>
        <el-tag v-if="matrix.sharedAllManage" type="danger">{{ t('skill.allManage') }}</el-tag>
        <el-tag v-if="matrix.sharedAllWrite" type="warning">{{ t('skill.allWrite') }}</el-tag>
        <el-tag v-if="matrix.sharedAllRead" type="success">{{ t('skill.allRead') }}</el-tag>
        <el-tag v-for="team in matrix.teams" :key="team.id" data-test="granted-team">
          {{ t('skill.teamWithPermission', { team: teamDisplayName(team), permission: t(permissionText(team.permission)) }) }}
        </el-tag>
        <el-tag v-for="member in matrix.members" :key="member.username" type="info" data-test="granted-member">
          {{ t('skill.memberWithPermission', { member: shortUsername(props.scope, member.username), permission: t(permissionText(member.permission)) }) }}
        </el-tag>
      </el-space>
    </el-card>

    <el-card v-if="(context?.releases?.length ?? 0) > 0" class="section-card" data-test="release-history-card">
      <template #header>{{ t('skill.releaseHistory', { count: formatNumber(context!.releases.length) }) }}</template>
      <el-collapse>
        <el-collapse-item :title="t('actions.expandReleases')">
          <el-table :data="context!.releases" size="small" data-test="release-history-table">
            <el-table-column :label="t('columns.version')" width="90">
              <template #default="{ row }">
                <code class="skill-version">v{{ row.version }}</code>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.releasedAt')" width="170">
              <template #default="{ row }">{{ row.createdAt ? formatDate(row.createdAt) : '—' }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.notes')">
              <template #default="{ row }">{{ row.notes || '—' }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.sourceCommit')" width="120">
              <template #default="{ row }">
                <code class="skill-version">{{ shortCommit(row.sourceCommit) }}</code>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.publisher')" width="120">
              <template #default="{ row }">{{ shortUsername(props.scope, row.createdBy) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="80">
              <template #default="{ row }">
                <el-tooltip
                  :disabled="canManage"
                  :content="t('skill.manageRequired')"
                  placement="top"
                >
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!canManage"
                      :data-test="`delete-release-${row.version}`"
                      @click="deleteRelease(row.version)"
                    >
                      {{ t('actions.delete') }}
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-card class="section-card" data-test="lifecycle-card">
      <template #header>{{ t('skill.lifecycle') }}</template>
      <el-space wrap>
        <el-button
          v-if="canArchive && context?.status !== 'archived' && context?.status !== 'deleting'"
          data-test="archive-skill"
          @click="archiveSkill"
        >
          {{ t('skill.archive') }}
        </el-button>
        <el-button
          v-if="lifecycle?.canRestore && context?.status === 'archived'"
          type="primary"
          data-test="restore-skill"
          @click="restoreSkill"
        >
          {{ t('skill.restore') }}
        </el-button>
        <el-button
          v-if="lifecycle?.canDelete && (context?.status === 'archived' || context?.status === 'delete_failed')"
          type="danger"
          data-test="delete-skill"
          @click="openDeleteDialog"
        >
          {{ t('skill.deleteSkill') }}
        </el-button>
      </el-space>
      <el-alert
        v-if="context?.status === 'delete_failed'"
        type="error"
        :title="context.deletionError || t('organization.lastDeleteFailedRetry')"
        :closable="false"
        class="lifecycle-alert"
      />

      <el-divider v-if="deleteDialogVisible" />
      <div v-if="deleteDialogVisible" class="delete-dialog">
        <el-alert
          type="warning"
          :title="t('skill.deleteDisabled')"
          :closable="false"
          class="lifecycle-alert"
        />
        <div class="delete-context" data-test="delete-context">
          <p>{{ t('skill.releasesToRemove', { count: deleteContext?.releasesRemoved ?? '—' }) }}</p>
          <p>{{ t('skill.everPublished', { value: deleteContext?.everPublished ? t('status.yes') : t('status.no') }) }}</p>
          <p>
            {{ t('skill.dependents') }}
            <span v-if="deleteContext?.dependents?.length">
              {{ deleteContext.dependents.join('、') }}
            </span>
            <span v-else>{{ t('status.none') }}</span>
          </p>
        </div>
        <el-input
          v-model="deleteReason"
          data-test="delete-reason-input"
          type="textarea"
          :rows="2"
          :placeholder="t('skill.deleteReasonPlaceholder')"
        />
        <el-input
          v-model="deleteConfirm"
          data-test="delete-confirm-input"
          :placeholder="t('skill.deleteConfirmPlaceholder', { identity: `${props.scope}/${props.skillName}` })"
        />
        <div class="delete-actions">
          <el-button @click="deleteDialogVisible = false">{{ t('actions.cancel') }}</el-button>
          <el-button type="danger" data-test="confirm-delete-skill" @click="deleteWholeSkill">{{ t('actions.confirmDelete') }}</el-button>
        </div>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>{{ t('columns.shareStatus') }}</template>
      <el-space wrap>
        <el-tag :type="visibility === 'public' ? 'success' : 'info'" data-test="visibility-tag">
          {{ visibility === 'public' ? t('skill.visibilityPublic') : t('skill.visibilityPrivate') }}
        </el-tag>
        <el-switch
          :model-value="visibility === 'public'"
          :disabled="!canManage"
          data-test="visibility-switch"
          @change="onVisibilityChange"
        />
      </el-space>
    </el-card>

    <el-card class="section-card">
      <template #header>{{ t('skill.currentShare') }}</template>
      <el-radio-group
        :model-value="shareLevel"
        :disabled="!canManage"
        data-test="share-level"
        @change="onShareLevelChange"
      >
        <el-radio value="none">{{ t('skill.private') }}</el-radio>
        <el-radio value="read">{{ t('skill.allRead') }}</el-radio>
        <el-radio value="write">{{ t('skill.allWrite') }}</el-radio>
        <el-radio value="manage">{{ t('skill.allManage') }}</el-radio>
      </el-radio-group>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>{{ t('skill.teamAuthorizationTitle') }}</template>
          <div class="grant-row">
            <el-select
              v-if="teamOptions.length"
              v-model="selectedTeam"
              :disabled="!canManage"
              data-test="team-select"
              :placeholder="t('skill.teamSelectPlaceholder')"
              style="width: 220px"
            >
              <el-option v-for="team in teamOptions" :key="team.name" :label="teamLabel(team)" :value="team.name" />
            </el-select>
            <el-input
              v-else
              v-model="selectedTeam"
              :disabled="!canManage"
              data-test="team-input"
              :placeholder="t('skill.teamNamePlaceholder')"
              style="width: 220px"
            />
            <el-select v-model="teamPermission" :disabled="!canManage" data-test="team-permission" style="width: 110px">
              <el-option :label="t('skill.access.read')" value="read" />
              <el-option :label="t('skill.access.write')" value="write" />
              <el-option :label="t('skill.access.manage')" value="manage" />
            </el-select>
            <el-button type="primary" :disabled="!canManage" data-test="grant-team" @click="grantTeam">{{ t('actions.addAuthorization') }}</el-button>
          </div>
          <el-table v-if="matrix.teams.length" :data="matrix.teams" size="small">
            <el-table-column :label="t('nav.orgTeams')">
              <template #default="{ row }">{{ teamDisplayName(row) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="80">
              <template #default="{ row }">
                <el-button
                  link
                  type="danger"
                  :disabled="!canManage"
                  :data-test="`revoke-team-${row.name}`"
                  @click="applyAction('remove_team', { team_id: row.id })"
                >
                  {{ t('actions.remove') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>{{ t('skill.memberAuthorizationTitle') }}</template>
          <div class="grant-row">
            <el-select
              v-if="memberOptions.length"
              v-model="selectedMember"
              :disabled="!canManage"
              filterable
              allow-create
              data-test="member-select"
              :placeholder="t('skill.memberUsernamePlaceholder')"
              style="width: 220px"
            >
              <el-option
                v-for="member in memberOptions"
                :key="member.username"
                :label="shortUsername(props.scope, member.username)"
                :value="member.username"
              />
            </el-select>
            <el-input
              v-else
              v-model="selectedMember"
              :disabled="!canManage"
              data-test="member-input"
              :placeholder="t('skill.memberUsernameWithOrgPlaceholder')"
              style="width: 220px"
            />
            <el-select v-model="memberPermission" :disabled="!canManage" data-test="member-permission" style="width: 110px">
              <el-option :label="t('skill.access.read')" value="read" />
              <el-option :label="t('skill.access.write')" value="write" />
              <el-option :label="t('skill.access.manage')" value="manage" />
            </el-select>
            <el-button type="primary" :disabled="!canManage" data-test="grant-member" @click="grantMember">{{ t('actions.addAuthorization') }}</el-button>
          </div>
          <el-table v-if="matrix.members.length" :data="matrix.members" size="small">
            <el-table-column :label="t('columns.member')">
              <template #default="{ row }">{{ shortUsername(props.scope, row.username) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.permission')" width="80">
              <template #default="{ row }">{{ t(permissionText(row.permission)) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="80">
              <template #default="{ row }">
                <el-button
                  link
                  type="danger"
                  :disabled="!canManage"
                  :data-test="`revoke-member-${row.username}`"
                  @click="applyAction('remove_member', { username: row.username })"
                >
                  {{ t('actions.remove') }}
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
import { formatRequestError, useLocaleState } from '../i18n/locale';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiRequest } from '../api/client';
import { shortUsername } from '../utils/short-username';
import {
  deriveShareState,
  statusText,
  type DeleteContext,
  type MemberOption,
  type PermissionMatrix,
  type PermissionsResponse,
  type SkillContext,
  type TeamOption
} from '../skills/skill-list';

const { t, formatDate, formatNumber } = useLocaleState();

const route = useRoute();
const router = useRouter();
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
const lifecycle = ref<PermissionsResponse['viewerLifecycle']>();
const deleteDialogVisible = ref(false);
const deleteContext = ref<DeleteContext>();
const deleteReason = ref('');
const deleteConfirm = ref('');
// 变更类控件的可用性以服务端的判定为准(POST 仍会守门);旧服务端不带该字段时
// 退化为不可用,不出现「能点但必然 403」的按钮。
const viewerAccess = ref<PermissionsResponse['viewerAccess']>(undefined);
const canManage = computed(() => viewerAccess.value === 'manage');
const canArchive = computed(() => lifecycle.value?.canArchive ?? canManage.value);
const errorMessage = ref('');

const selectedTeam = ref('');
const teamPermission = ref<'read' | 'write' | 'manage'>('read');
const selectedMember = ref('');
const memberPermission = ref<'read' | 'write' | 'manage'>('read');

// 所有者成员提供团队/成员下拉建议；普通成员视角退化为手工输入
const teamOptions = computed(() => props.teamOptions ?? []);
const memberOptions = computed(() => props.memberOptions ?? []);

const shareState = computed(() => deriveShareState(matrix.value));

const stateText = computed(() => t(shareState.value.text));

const stateTagType = computed(() => shareState.value.tagType);

// 逐技能可见性(ADR-0032):public/private 由技能记录携带,经专用端点切换
const visibility = ref<'public' | 'private'>('private');

async function onVisibilityChange(next: boolean | string | number): Promise<void> {
  const target = next ? 'public' : 'private';
  try {
    const result = await apiRequest<{ name: string; visibility: 'public' | 'private' }>(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/visibility`,
      { method: 'POST', body: { visibility: target } }
    );
    visibility.value = result.visibility;
    ElMessage.success(result.visibility === 'public' ? t('skill.publicVisibilityOn') : t('skill.privateVisibilityOn'));
  } catch (error) {
    ElMessage.error(formatRequestError(error));
  }
}

// 常设团队授权(ADR-0032):由共享状态推导当前单选档位
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
  if (permission === 'manage' || permission === 'admin' || permission === 'owner') return 'skill.access.manage';
  return permission === 'write' ? 'skill.access.write' : 'skill.access.read';
}

function teamLabel(team: TeamOption): string {
  return team.permission
    ? t('skill.teamWithPermission', { team: teamDisplayName(team), permission: t(permissionText(team.permission)) })
    : teamDisplayName(team);
}

// ADR-0029:界面优先展示团队显示名(允许中文),未设置回退标识名。
// 团队授权使用逻辑团队的稳定 read 投影 ID，权限档只在当前技能生效。
function teamDisplayName(team: { name: string; display_name?: string }): string {
  return team.display_name || team.name;
}

// 上下文状态与列表页 statusText 一致,但已归档是明确的终态,如实单列
const contextStatusText = computed(() => {
  const status = context.value?.status;
  if (status === 'archived') return t('skill.state.archived');
  return t(statusText(status));
});

const contextStatusType = computed<'success' | 'warning' | 'danger'>(() => {
  const status = context.value?.status;
  if (status === 'archived' || status === 'delete_failed') return 'warning';
  if (status === 'deleting') return 'danger';
  return 'success';
});

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
    errorMessage.value = formatRequestError(error);
  }
}

// permissions 响应携带只读技能上下文与查看者权限档,统一在此拆分:矩阵进 matrix,
// skill 块进 context,viewerAccess 单独存——它描述的是「我是谁」,不是矩阵内容。
function assignPermissionsResponse(response: PermissionsResponse): void {
  const { skill, viewerAccess: accessLevel, ...matrixResponse } = response;
  context.value = skill;
  viewerAccess.value = accessLevel;
  lifecycle.value = response.viewerLifecycle;
  matrix.value = matrixResponse;
  // 可见性随技能记录一并下发（public/private）
  visibility.value = (skill as { visibility?: 'public' | 'private' }).visibility ?? 'private';
}

// 生命周期操作(CONTEXT:技能生命周期):Archive 是可恢复停用；Delete 是两阶段
// 删除的第二阶段。删除上下文必须先展示依赖方，原因和完整身份在提交前本地校验。
async function archiveSkill(): Promise<void> {
  try {
    await apiRequest(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/archive`,
      { method: 'POST' }
    );
    ElMessage.success(t('skill.skillArchived'));
    await loadMatrix();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function restoreSkill(): Promise<void> {
  try {
    await apiRequest(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/restore`,
      { method: 'POST' }
    );
    ElMessage.success(t('skill.skillRestored'));
    await loadMatrix();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function openDeleteDialog(): Promise<void> {
  errorMessage.value = '';
  try {
    deleteContext.value = await apiRequest<DeleteContext>(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/delete-context`
    );
    deleteReason.value = '';
    deleteConfirm.value = '';
    deleteDialogVisible.value = true;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function deleteWholeSkill(): Promise<void> {
  const reason = deleteReason.value.trim();
  const identity = `@${props.scope}/${props.skillName}`;
  if (!reason) {
    errorMessage.value = t('skill.reasonRequired');
    return;
  }
  if (deleteConfirm.value.trim() !== identity) {
    errorMessage.value = t('skill.confirmIdentity', { identity });
    return;
  }
  try {
    await apiRequest(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/delete`,
      { method: 'POST', body: { confirm: identity, reason } }
    );
    deleteDialogVisible.value = false;
    ElMessage.success(t('skill.skillDeleted'));
    await router.push(String(route.name ?? '').startsWith('super-') ? { name: 'super-skills' } : { name: 'me-skills' });
  } catch (error) {
    await loadMatrix();
    errorMessage.value = formatRequestError(error);
  }
}

// 单版本删除(CONTEXT:单版本删除):不可变发布模型下的外科手术式清理。服务端以
// 「confirm 必须等于版本号」表达显式确认,这里用输入框承载;依赖引用等守卫由服务端
// 判定,拒绝原因(含引用方)原样呈现,不在这里替用户做取舍。
async function deleteRelease(version: string): Promise<void> {
  errorMessage.value = '';
  let answer: string;
  try {
    const result = await ElMessageBox.prompt(
      t('skill.releaseDeleteWarning', { version }),
      t('skill.releaseDeleteTitle'),
      {
        confirmButtonText: t('actions.delete'),
        cancelButtonText: t('actions.cancel'),
        inputPlaceholder: version,
        type: 'warning'
      }
    );
    answer = result.value ?? '';
  } catch {
    return; // 用户取消
  }
  if (answer.trim() !== version) {
    errorMessage.value = t('skill.confirmReleaseVersion', { version });
    return;
  }

  try {
    await apiRequest(
      `/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}` +
        `/releases/${encodeURIComponent(version)}/delete`,
      { method: 'POST', body: { confirm: version } }
    );
    ElMessage.success(t('skill.releaseDeleted', { version }));
    await loadMatrix();
  } catch (error) {
    errorMessage.value = formatRequestError(error);
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
    errorMessage.value = formatRequestError(error);
    return false;
  }
}

async function grantTeam(): Promise<void> {
  if (!selectedTeam.value) {
    errorMessage.value = t('skill.teamNameRequired');
    return;
  }
  const team = selectedTeam.value;
  const option = teamOptions.value.find((entry) => entry.name === team);
  const payload = option
    ? { team_id: option.id, permission: teamPermission.value }
    : { team, permission: teamPermission.value };
  if (await applyAction('set_team', payload)) {
    selectedTeam.value = '';
    ElMessage.success(t('skill.teamAuthorizationUpdated'));
  }
}

async function grantMember(): Promise<void> {
  if (!selectedMember.value) {
    errorMessage.value = t('skill.memberUsernameRequired');
    return;
  }
  const username = selectedMember.value;
  if (await applyAction('add_member', { username, permission: memberPermission.value })) {
    selectedMember.value = '';
    ElMessage.success(t('skill.memberAuthorizationUpdated'));
  }
}

onMounted(loadMatrix);
</script>

<style scoped>
.delete-dialog {
  display: grid;
  gap: 10px;
}
.delete-context p {
  margin: 0 0 6px;
}
.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.lifecycle-alert {
  margin-top: 10px;
}

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

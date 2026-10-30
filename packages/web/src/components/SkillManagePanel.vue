<template>
  <div data-test="skill-manage-panel">
    <div class="console-toolbar">
      <div class="panel-identity">
        <h2 class="panel-title">{{ t('skill.manageTitle', { identity: context?.displayName ?? skillName }) }}</h2>
        <div class="panel-identity-meta">
          <el-tag size="small" :type="isPersonalNamespace ? 'info' : 'primary'">
            {{ t(isPersonalNamespace ? 'skill.namespaceTypePersonal' : 'skill.namespaceTypeOrganization') }}
          </el-tag>
          <code class="skill-path">@{{ scope }}/{{ skillName }}</code>
        </div>
      </div>
      <el-tag :type="stateTagType" data-test="share-state">{{ stateText }}</el-tag>
    </div>

    <el-card class="section-card" data-test="skill-context-card">
      <template #header>{{ t('skill.info') }}</template>
      <div class="skill-context">
        <div class="skill-desc-row">
          <span v-if="context?.description" data-test="skill-description">{{ context.description }}</span>
          <span v-else class="context-empty" data-test="skill-description">{{ t('skill.noDescription') }}</span>
        </div>
        <el-space v-if="keywords.length" wrap class="skill-keywords" data-test="skill-keywords">
          <span class="skill-keywords-label">{{ t('skill.keywords') }}</span>
          <el-tag
            v-for="keyword in keywords"
            :key="keyword"
            size="small"
            type="info"
            effect="plain"
            data-test="skill-keyword"
          >
            {{ keyword }}
          </el-tag>
        </el-space>
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
          <span class="skill-meta" data-test="skill-download-count">
            {{ t('skill.downloadCount', { count: formatNumber(downloadCount) }) }}
          </span>
        </el-space>
      </div>
    </el-card>

    <el-card class="section-card" data-test="current-authorization-card">
      <template #header>{{ t('skill.currentAuthorization') }}</template>
      <el-space wrap>
        <el-tag v-if="matrix.sharedAllManage" type="danger">{{ t('skill.allManage') }}</el-tag>
        <el-tag v-if="matrix.sharedAllWrite" type="warning">{{ t('skill.allWrite') }}</el-tag>
        <el-tag v-if="matrix.sharedAllRead" type="success">{{ t('skill.allRead') }}</el-tag>
        <el-tag v-for="team in matrix.teams" :key="team.id" data-test="granted-team">
          {{ t('skill.teamWithPermission', { team: teamDisplayName(team), permission: t(permissionText(team.permission)) }) }}
        </el-tag>
        <el-tag v-for="member in matrix.members" :key="member.username" type="info" data-test="granted-member">
          {{ t('skill.memberWithPermission', { member: member.username, permission: t(permissionText(member.permission)) }) }}
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
                      :disabled="!canManage || saving"
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

    <el-card class="section-card" data-test="visibility-card">
      <template #header>{{ t('skill.visibility') }}</template>
      <el-space wrap>
        <el-tag :type="visibility === 'public' ? 'success' : 'info'" data-test="visibility-tag">
          {{ visibility === 'public' ? t('skill.visibilityPublic') : t('skill.visibilityPrivate') }}
        </el-tag>
        <el-switch
          :model-value="visibility === 'public'"
          :disabled="!canManage || saving"
          data-test="visibility-switch"
          @change="onVisibilityChange"
        />
      </el-space>
    </el-card>

    <el-card v-if="!isPersonalNamespace" class="section-card" data-test="org-wide-authorization-card">
      <template #header>{{ t('skill.orgWideAuthorization') }}</template>
      <el-radio-group
        :model-value="shareLevel"
        :disabled="!canManage || saving"
        data-test="share-level"
        @change="onShareLevelChange"
      >
        <el-radio value="none">{{ t('skill.private') }}</el-radio>
        <el-radio value="read">{{ t('skill.allRead') }}</el-radio>
        <el-radio value="write">{{ t('skill.allWrite') }}</el-radio>
        <el-radio value="manage">{{ t('skill.allManage') }}</el-radio>
      </el-radio-group>
    </el-card>

    <p>{{ t('skill.effectivePermissionHint') }}</p>
    <el-row :gutter="16">
      <el-col v-if="!isPersonalNamespace" :span="12">
        <el-card class="section-card">
          <template #header>{{ t('skill.teamAuthorizationTitle') }}</template>
          <div class="grant-row">
            <el-select
              v-model="selectedTeam"
              :disabled="!canManage || saving"
              filterable
              data-test="team-select"
              :placeholder="t('skill.teamSelectPlaceholder')"
              style="width: 220px"
            >
              <el-option v-for="team in teamOptions" :key="team.name" :label="teamLabel(team)" :value="team.name" />
            </el-select>
            <el-select v-model="teamPermission" :disabled="!canManage || saving" data-test="team-permission" style="width: 110px">
              <el-option :label="t('skill.access.read')" value="read" />
              <el-option :label="t('skill.access.write')" value="write" />
              <el-option :label="t('skill.access.manage')" value="manage" />
            </el-select>
            <el-button type="primary" :disabled="!canManage || saving" data-test="grant-team" @click="grantTeam">{{ t('actions.addAuthorization') }}</el-button>
          </div>
          <el-table v-if="matrix.teams.length" :data="matrix.teams" size="small">
            <el-table-column :label="t('nav.orgTeams')">
              <template #default="{ row }">{{ teamDisplayName(row) }}</template>
            </el-table-column>
            <el-table-column :label="t('skill.grantPermission')" width="120">
              <template #default="{ row }">
                <el-select v-if="editing?.kind === 'team' && editing.key === row.id" v-model="editing.permission" :disabled="saving" :data-test="`edit-team-permission`">
                  <el-option v-for="permission in ['read', 'write', 'manage']" :key="permission" :value="permission" :label="t(permissionText(permission))" />
                </el-select>
                <span v-else>{{ t(permissionText(row.permission)) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="150">
              <template #default="{ row }">
                <template v-if="editing?.kind === 'team' && editing.key === row.id">
                  <el-button link :disabled="saving" :data-test="`save-team-${row.id}`" @click="saveEdit">{{ t('actions.save') }}</el-button>
                  <el-button link :disabled="saving" @click="editing = undefined">{{ t('actions.cancel') }}</el-button>
                </template>
                <el-button v-else link :disabled="!canManage || saving" :data-test="`edit-team-${row.id}`" @click="startEdit('team', row.id, row.permission)">{{ t('actions.edit') }}</el-button>
                <el-button
                  link
                  type="danger"
                  :disabled="!canManage || saving"
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
              v-if="!isPersonalNamespace"
              v-model="selectedMember"
              :disabled="!canManage || saving"
              filterable
              data-test="member-select"
              :placeholder="t('skill.memberUsernamePlaceholder')"
              style="width: 220px"
            >
              <el-option
                v-for="member in memberOptions"
                :key="member.username"
                :label="member.username"
                :value="member.username"
              />
            </el-select>
            <el-input
              v-else
              v-model="selectedMember"
              :disabled="!canManage || saving"
              data-test="member-input"
              :placeholder="t('skill.memberUsernamePlaceholder')"
              style="width: 220px"
            />
            <el-button v-if="isPersonalNamespace" :disabled="!canManage || saving" data-test="find-member" @click="findMember">{{ t('actions.search') }}</el-button>
            <el-button v-if="foundMember && isPersonalNamespace" data-test="confirm-member" @click="confirmedMember = foundMember">{{ t('skill.confirmMember', { username: foundMember }) }}</el-button>
            <span v-if="confirmedMember && isPersonalNamespace" data-test="confirmed-member">{{ confirmedMember }}</span>
            <el-select v-model="memberPermission" :disabled="!canManage || saving" data-test="member-permission" style="width: 110px">
              <el-option :label="t('skill.access.read')" value="read" />
              <el-option :label="t('skill.access.write')" value="write" />
              <el-option :label="t('skill.access.manage')" value="manage" />
            </el-select>
            <el-button type="primary" :disabled="!canManage || saving" data-test="grant-member" @click="grantMember">{{ t('actions.addAuthorization') }}</el-button>
          </div>
          <el-table v-if="matrix.members.length" :data="matrix.members" size="small">
            <el-table-column :label="t('columns.member')">
              <template #default="{ row }">{{ row.username }}</template>
            </el-table-column>
            <el-table-column :label="t('skill.grantPermission')" width="120">
              <template #default="{ row }">
                <el-select v-if="editing?.kind === 'member' && editing.key === row.username" v-model="editing.permission" :disabled="saving" :data-test="`edit-member-permission`">
                  <el-option v-for="permission in ['read', 'write', 'manage']" :key="permission" :value="permission" :label="t(permissionText(permission))" />
                </el-select>
                <span v-else>{{ t(permissionText(row.permission)) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="150">
              <template #default="{ row }">
                <template v-if="editing?.kind === 'member' && editing.key === row.username">
                  <el-button link :disabled="saving" :data-test="`save-member-${row.username}`" @click="saveEdit">{{ t('actions.save') }}</el-button>
                  <el-button link :disabled="saving" @click="editing = undefined">{{ t('actions.cancel') }}</el-button>
                </template>
                <el-button v-else link :disabled="!canManage || saving" :data-test="`edit-member-${row.username}`" @click="startEdit('member', row.username, row.permission)">{{ t('actions.edit') }}</el-button>
                <el-button
                  link
                  type="danger"
                  :disabled="!canManage || saving"
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
// 关键词（#142）：随技能上下文下发；旧服务端缺字段时按空数组处理，不渲染空容器。
const keywords = computed(() => context.value?.keywords ?? []);
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
// ADR-0064:服务端按 skill 的命名空间归属判个人技能;旧服务端不带该字段时视为
// 组织技能,保持向后兼容的默认展示。
const personalNamespace = ref<boolean>(false);
const isPersonalNamespace = computed(() => personalNamespace.value);
const errorMessage = ref('');
// 下载量（ADR-0067）：跨版本汇总的公开信号，权限响应不携带，单独从技能清单取一次。
const downloadCount = ref(0);

const selectedTeam = ref('');
const teamPermission = ref<'read' | 'write' | 'manage'>('read');
const selectedMember = ref('');
const memberPermission = ref<'read' | 'write' | 'manage'>('read');

const candidates = ref<{ teams: TeamOption[]; members: MemberOption[] }>({ teams: [], members: [] });
const teamOptions = computed(() => candidates.value.teams.filter(team => !matrix.value.teams.some(grant => grant.id === team.id)));
const memberOptions = computed(() => candidates.value.members.filter(member => !matrix.value.members.some(grant => grant.username === member.username)));
const confirmedMember = ref('');
const foundMember = ref('');
const editing = ref<{ kind: 'team' | 'member'; key: number | string; permission: 'read' | 'write' | 'manage' }>();
const saving = ref(false);

function startEdit(kind: 'team' | 'member', key: number | string, permission: string): void {
  editing.value = { kind, key, permission: permission === 'write' ? 'write' : permission === 'manage' ? 'manage' : 'read' };
}

async function saveEdit(): Promise<void> {
  if (!editing.value || saving.value) return;
  const current = editing.value;
  saving.value = true;
  try {
    if (await applyAction(current.kind === 'team' ? 'set_team' : 'add_member', {
      ...(current.kind === 'team' ? { team_id: current.key } : { username: current.key }),
      permission: current.permission, mode: 'edit'
    })) editing.value = undefined;
  } finally { saving.value = false; }
}

async function loadCandidates(query = ''): Promise<void> {
  if (!canManage.value) return;
  const result = await apiRequest<{ teams: TeamOption[]; members: MemberOption[] }>(`/api/skills/${encodeURIComponent(props.scope)}/${encodeURIComponent(props.skillName)}/permission-candidates?q=${encodeURIComponent(query)}`);
  candidates.value = { teams: result.teams ?? [], members: result.members ?? [] };
}

async function findMember(): Promise<void> {
  confirmedMember.value = '';
  foundMember.value = '';
  errorMessage.value = '';
  try {
    await loadCandidates(selectedMember.value.trim());
    foundMember.value = candidates.value.members[0]?.username ?? '';
    if (!foundMember.value) errorMessage.value = t('skill.memberNotAvailable');
  } catch (error) { errorMessage.value = formatRequestError(error); }
}

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
  const { skill, viewerAccess: accessLevel, personalNamespace: isPersonal, ...matrixResponse } = response;
  context.value = skill;
  viewerAccess.value = accessLevel;
  lifecycle.value = response.viewerLifecycle;
  matrix.value = matrixResponse;
  personalNamespace.value = isPersonal === true;
  // 可见性随技能记录一并下发（public/private）
  visibility.value = skill?.visibility ?? 'private';
  // 公开下载量随技能上下文一并下发（ADR-0067），无需另发清单请求。
  downloadCount.value = skill?.downloadCount ?? 0;
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
    const message = formatRequestError(error);
    await loadMatrix();
    try { await loadCandidates(); } catch { /* 保留原始变更错误，允许用户重试。 */ }
    errorMessage.value = message;
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
  if (await applyAction('set_team', { ...payload, mode: 'create' })) {
    selectedTeam.value = '';
    ElMessage.success(t('skill.teamAuthorizationUpdated'));
  }
}

async function grantMember(): Promise<void> {
  if (!selectedMember.value) {
    errorMessage.value = t('skill.memberUsernameRequired');
    return;
  }
  const username = selectedMember.value.trim();
  if (isPersonalNamespace.value && confirmedMember.value !== username) {
    errorMessage.value = t('skill.confirmMemberFirst');
    return;
  }
  if (await applyAction('add_member', { username, permission: memberPermission.value, mode: 'create' })) {
    selectedMember.value = '';
    confirmedMember.value = '';
    foundMember.value = '';
    ElMessage.success(t('skill.memberAuthorizationUpdated'));
  }
}

onMounted(async () => {
  await loadMatrix();
  try { await loadCandidates(); } catch (error) { errorMessage.value = formatRequestError(error); }
});
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

.panel-identity {
  min-width: 0;
}

.panel-identity-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.panel-title {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 技能标识符是技术坐标,用等宽字体呈现 */
.skill-path {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  color: var(--el-text-color-secondary);
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.context-empty {
  color: var(--el-text-color-secondary);
}

.skill-keywords {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.skill-keywords-label {
  flex-shrink: 0;
}

/* 长关键词在标签内换行，多个关键词由 el-space 的 wrap 自动折行，避免溢出。 */
.skill-keywords :deep(.el-tag) {
  max-width: 100%;
  height: auto;
  white-space: normal;
  overflow-wrap: anywhere;
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

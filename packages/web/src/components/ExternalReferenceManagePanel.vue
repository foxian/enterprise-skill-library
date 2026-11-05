<template>
  <div data-test="external-manage-panel">
    <PageBreadcrumb :items="breadcrumbItems" />
    <div class="console-toolbar">
      <el-button
        text
        data-test="external-back-to-list"
        :icon="ArrowLeft"
        @click="backToSkillList"
      >
        {{ t('common.back') }}
      </el-button>
      <div class="panel-identity">
        <h2 class="panel-title">{{ t('external.title') }}</h2>
        <code class="skill-path">@{{ scope }}/{{ skillName }}</code>
      </div>
      <el-tag :type="stateTagType" data-test="external-state-tag">{{ stateText }}</el-tag>
    </div>

    <el-alert
      :title="t('external.readOnlyHint')"
      type="warning"
      :closable="false"
      class="readonly-alert"
      data-test="external-readonly-alert"
    />

    <el-alert
      v-if="message"
      :type="messageType"
      :title="message"
      :closable="false"
      class="readonly-alert"
      data-test="external-message"
    />

    <el-card class="section-card" data-test="external-info-card" v-loading="loading">
      <template #header>{{ t('external.info') }}</template>
      <el-descriptions :column="1" border label-width="96px">
        <el-descriptions-item :label="t('external.skillName')">
          <code data-test="external-view-name">{{ reference?.skillName }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.description')">
          <span data-test="external-view-description">
            {{ reference?.description || t('external.noDescription') }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.latestVersion')">
          <span data-test="external-view-version">{{ reference?.latestVersion ?? '—' }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="section-card" data-test="external-source-card">
      <template #header>
        <div class="card-header">
          <span>{{ t('external.source') }}</span>
          <el-button
            size="small"
            data-test="external-edit-source-btn"
            @click="openEditSource"
          >
            {{ t('external.editSource') }}
          </el-button>
        </div>
      </template>
      <el-descriptions :column="1" border label-width="140px">
        <el-descriptions-item :label="t('external.repositoryUrl')">
          <code data-test="external-view-url">{{ reference?.repositoryUrl }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.skillDirectory')">
          <code data-test="external-view-directory">{{ reference?.skillDirectory }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.branch')">
          <code data-test="external-view-branch">{{ reference?.branch }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.lastSyncedCommit')">
          <code data-test="external-view-commit">{{ shortCommit(reference?.lastSyncedCommit) }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.lastSuccessfulAt')">
          {{ formatDate(reference?.lastSuccessfulAt) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.lastCheckedAt')">
          {{ formatDate(reference?.lastCheckedAt) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.nextCheckAt')">
          {{ formatDate(reference?.nextCheckAt) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="reference?.currentError" :label="t('external.currentError')">
          <span class="error-text" data-test="external-view-error">{{ reference.currentError }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="section-card" data-test="external-license-card">
      <template #header>{{ t('external.license') }}</template>
      <el-descriptions :column="1" border label-width="96px">
        <el-descriptions-item :label="t('external.licenseBasis')">
          <span data-test="external-view-license">{{ reference?.license.basis ?? '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.licenseConfirmedBy')">
          {{ reference?.license.confirmedBy ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.licenseConfirmedAt')">
          {{ formatDate(reference?.license.confirmedAt) }}
        </el-descriptions-item>
      </el-descriptions>
      <div class="license-confirm-row">
        <el-input
          v-model="licenseBasis"
          data-test="external-license-input"
          :placeholder="t('external.licenseBasisPlaceholder')"
          style="max-width: 280px"
        />
        <el-button
          type="primary"
          data-test="external-license-confirm-btn"
          :loading="busy"
          @click="confirmLicense"
        >
          {{ t('external.confirmLicense') }}
        </el-button>
      </div>
    </el-card>

    <el-card class="section-card" data-test="external-config-card">
      <template #header>{{ t('external.schedule') }}</template>
      <el-form label-position="top">
        <div class="config-grid">
          <div>
            <label class="config-label">{{ t('external.frequency') }}</label>
            <el-select v-model="draft.schedule.frequency" data-test="external-edit-frequency" style="width: 100%">
              <el-option :label="t('external.daily')" value="daily" />
              <el-option :label="t('external.weekly')" value="weekly" />
              <el-option :label="t('external.monthly')" value="monthly" />
            </el-select>
          </div>
          <div v-if="draft.schedule.frequency === 'weekly'">
            <label class="config-label">{{ t('external.weekday') }}</label>
            <el-select v-model="draft.schedule.weekday" data-test="external-edit-weekday" style="width: 100%">
              <el-option v-for="day in weekOptions" :key="day.value" :label="t(day.label)" :value="day.value" />
            </el-select>
          </div>
          <div v-if="draft.schedule.frequency === 'monthly'">
            <label class="config-label">{{ t('external.dayOfMonth') }}</label>
            <el-input v-model.number="draft.schedule.dayOfMonth" type="number" min="1" max="31" data-test="external-edit-day" />
          </div>
          <div>
            <label class="config-label">{{ t('external.time') }}</label>
            <el-input v-model="draft.schedule.time" data-test="external-edit-time" />
          </div>
          <div>
            <label class="config-label">{{ t('external.timeZone') }}</label>
            <el-input v-model="draft.schedule.timeZone" data-test="external-edit-timezone" />
          </div>
          <div>
            <label class="config-label">{{ t('external.visibility') }}</label>
            <el-select v-model="draft.visibility" data-test="external-edit-visibility" style="width: 100%">
              <el-option :label="t('external.visibilityPrivate')" value="private" />
              <el-option :label="t('external.visibilityPublic')" value="public" />
            </el-select>
          </div>
        </div>
        <div class="config-actions">
          <el-button type="primary" data-test="external-save-btn" :loading="busy" @click="save">
            {{ t('external.save') }}
          </el-button>
        </div>
      </el-form>
    </el-card>

    <el-card class="section-card" data-test="external-actions-card">
      <el-space wrap>
        <el-button type="primary" data-test="external-sync-btn" :loading="busy" @click="syncNow">
          {{ t('external.syncNow') }}
        </el-button>
        <el-button v-if="!isPaused" data-test="external-pause-btn" :loading="busy" @click="pause">
          {{ t('external.pause') }}
        </el-button>
        <el-button v-else type="success" data-test="external-resume-btn" :loading="busy" @click="resume">
          {{ t('external.resume') }}
        </el-button>
      </el-space>
    </el-card>

    <el-card class="section-card" data-test="external-remove-card">
      <template #header>{{ t('external.removeTitle') }}</template>
      <p class="remove-hint" data-test="external-remove-hint">{{ t('external.removeHint') }}</p>
      <el-button data-test="external-open-lifecycle" @click="openLifecycle">
        {{ t('external.openLifecycle') }}
      </el-button>
    </el-card>

    <el-dialog
      v-model="editVisible"
      :title="t('external.editSourceTitle')"
      width="600px"
      data-test="external-edit-source-dialog"
    >
      <el-form label-position="top">
        <el-form-item :label="t('external.repositoryUrl')">
          <el-input v-model="editUrl" data-test="external-edit-url" />
          <div class="form-hint">{{ t('external.repositoryUrlHint') }}</div>
        </el-form-item>
        <el-form-item :label="t('external.skillDirectory')">
          <el-input
            v-model="editDirectory"
            data-test="external-edit-directory"
            :placeholder="t('external.skillDirectoryPlaceholder')"
          />
          <div class="form-hint">{{ t('external.skillDirectoryHint') }}</div>
          <div class="form-hint">{{ t('external.editSourceHint') }}</div>
        </el-form-item>
      </el-form>

      <el-descriptions v-if="editPreview" :column="1" border label-width="96px" class="edit-preview">
        <el-descriptions-item :label="t('external.skillName')">
          <code data-test="external-edit-preview-name">{{ editPreview.skillName }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.description')">
          <span data-test="external-edit-preview-description">
            {{ editPreview.description || t('external.noDescription') }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.license')">
          <span data-test="external-edit-preview-license">
            {{
              editPreview.detectedLicense
                ? `${t('external.detectedLicense')}: ${editPreview.detectedLicense}`
                : t('external.noLicenseDetected')
            }}
          </span>
          <span v-if="editPreview.licenseProvenance" class="provenance">
            {{ editPreview.licenseProvenance.path }}
          </span>
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="editPreview && editPreview.licenseCandidates.length > 0" class="candidate-block">
        <div class="candidate-title">{{ t('external.licenseCandidates') }}</div>
        <el-radio-group v-model="editLicensePath" data-test="external-edit-license-candidates">
          <el-radio
            v-for="candidate in editPreview.licenseCandidates"
            :key="candidate.path"
            :value="candidate.path"
            class="candidate-option"
          >
            <code>{{ candidate.path }}</code>
            <el-tag v-if="candidate.insideSkillDirectory" size="small" type="info" class="candidate-tag">
              {{ t('external.insideSkillDirectory') }}
            </el-tag>
          </el-radio>
        </el-radio-group>
        <pre v-if="editSelectedCandidate" class="license-text">{{ editSelectedCandidate.text }}</pre>
      </div>

      <el-checkbox
        v-if="editPreview?.detectedLicense"
        v-model="editConfirmLicense"
        data-test="external-edit-confirm-license"
        class="confirm-license"
      >
        {{ t('external.confirmLicenseCheckbox') }}
      </el-checkbox>
      <el-alert
        v-if="editError"
        type="error"
        :title="editError"
        :closable="false"
        class="edit-error"
        data-test="external-edit-error"
      />

      <template #footer>
        <el-button data-test="external-edit-cancel" @click="editVisible = false">
          {{ t('common.cancel') }}
        </el-button>
        <el-button data-test="external-edit-preview-btn" :loading="editLoading" @click="previewEdit">
          {{ t('external.preview') }}
        </el-button>
        <el-button
          type="primary"
          data-test="external-edit-save-btn"
          :loading="editLoading"
          @click="saveSource"
        >
          {{ t('external.saveSource') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import { useLocaleState, formatRequestError } from '../i18n/locale';
import PageBreadcrumb, { type PageBreadcrumbItem } from './layout/PageBreadcrumb.vue';
import {
  orgScopeFromQuery,
  passthroughEntryQuery,
  resolveSkillListLocation
} from '../skills/manage-navigation';
import {
  confirmExternalLicense,
  getExternalReference,
  pauseExternalReference,
  previewExternalReference,
  resumeExternalReference,
  syncExternalReference,
  updateExternalReference,
  type ExternalPreviewResult,
  type ExternalReferenceView,
  type ExternalSyncState
} from '../skills/external-references';

const props = defineProps<{ scope: string; skillName: string }>();
const { t, formatDate } = useLocaleState();
const route = useRoute();
const router = useRouter();

const identity = computed(() => `@${props.scope}/${props.skillName}`);
const skillLocation = computed(() => ({
  name: 'me-skill-manage',
  params: { scope: props.scope, skillName: props.skillName },
  query: passthroughEntryQuery(route)
}));
// 面包屑把所属技能作为中间一级（外部引用是在技能之下配置的），
// 组织入口再在前面补 我的组织 / @org / 技能 三段。
const breadcrumbItems = computed<PageBreadcrumbItem[]>(() => {
  const items: PageBreadcrumbItem[] = [];
  const org = orgScopeFromQuery(route);
  if (org) {
    items.push(
      { label: t('nav.myOrganizations'), to: { name: 'me-orgs' }, test: 'crumb-my-orgs' },
      { label: `@${org}`, to: { name: 'me-org-members', params: { org } }, test: 'crumb-org' },
      { label: t('nav.skills'), to: resolveSkillListLocation(route, false), test: 'crumb-org-skills' }
    );
  } else {
    items.push(
      { label: t('nav.skills'), to: resolveSkillListLocation(route, false), test: 'crumb-skills' }
    );
  }
  items.push(
    { label: identity.value, to: skillLocation.value, test: 'crumb-skill' },
    { label: t('external.title'), test: 'crumb-current' }
  );
  return items;
});

const reference = ref<ExternalReferenceView | null>(null);
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('info');
const licenseBasis = ref('');

interface DraftState {
  schedule: ExternalReferenceView['schedule'];
  visibility: 'private' | 'public';
}

const draft = reactive<DraftState>({
  schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC' },
  visibility: 'private'
});

const weekOptions = [
  { value: 1, label: 'external.mon' },
  { value: 2, label: 'external.tue' },
  { value: 3, label: 'external.wed' },
  { value: 4, label: 'external.thu' },
  { value: 5, label: 'external.fri' },
  { value: 6, label: 'external.sat' },
  { value: 7, label: 'external.sun' }
] as const;

const stateLabels: Record<ExternalSyncState, string> = {
  idle: 'external.stateIdle',
  syncing: 'external.stateSyncing',
  paused: 'external.statePaused',
  failed: 'external.stateFailed'
};

const stateText = computed(() =>
  reference.value ? t(stateLabels[reference.value.syncState]) : ''
);
const stateTagType = computed(() => {
  switch (reference.value?.syncState) {
    case 'failed': return 'danger';
    case 'paused': return 'warning';
    case 'syncing': return 'info';
    default: return 'success';
  }
});
const isPaused = computed(() => reference.value?.syncState === 'paused');

// 编辑来源：低频操作，独立对话框；跟踪分支保持只读（ADR-0075）。
const editVisible = ref(false);
const editUrl = ref('');
const editDirectory = ref('');
const editPreview = ref<ExternalPreviewResult | null>(null);
const editLicensePath = ref('');
const editConfirmLicense = ref(false);
const editError = ref('');
const editLoading = ref(false);
const previewedEditUrl = ref('');
const previewedEditDirectory = ref('');

const editSelectedCandidate = computed(() =>
  editPreview.value?.licenseCandidates.find(
    (candidate) => candidate.path === editLicensePath.value
  )
);

function shortCommit(value?: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

function normalizedDirectory(): string {
  const directory = reference.value?.skillDirectory ?? '';
  return directory === '/' ? '' : directory;
}

function normalizeEditDirectory(): string {
  const directory = editDirectory.value.trim();
  return directory === '/' ? '' : directory;
}

function backToSkillList(): void {
  void router.push(resolveSkillListLocation(route, false));
}

function applyReference(next: ExternalReferenceView): void {
  reference.value = next;
  draft.schedule = { ...next.schedule };
  draft.visibility = next.visibility === 'public' ? 'public' : 'private';
  if (next.license.basis) licenseBasis.value = next.license.basis;
}

function flash(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
  message.value = text;
  messageType.value = type;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    applyReference(await getExternalReference(props.scope, props.skillName));
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  busy.value = true;
  try {
    const updated = await updateExternalReference(props.scope, props.skillName, {
      schedule: draft.schedule,
      visibility: draft.visibility
    });
    applyReference(updated);
    flash(t('external.save'), 'success');
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function syncNow(): Promise<void> {
  busy.value = true;
  try {
    const result = await syncExternalReference(props.scope, props.skillName);
    if (result.outcome === 'published') {
      flash(t('external.publishedAs', { version: result.version ?? '' }), 'success');
    } else if (result.outcome === 'unchanged') {
      flash(t('external.unchanged'), 'info');
    } else if (result.outcome === 'license-confirmation-required') {
      flash(t('external.licenseConfirmRequired'), 'error');
    } else {
      flash(result.error ?? t('external.syncFailed'), 'error');
    }
    await load();
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function pause(): Promise<void> {
  busy.value = true;
  try {
    applyReference(await pauseExternalReference(props.scope, props.skillName));
    flash(t('external.pause'), 'success');
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function resume(): Promise<void> {
  busy.value = true;
  try {
    applyReference(await resumeExternalReference(props.scope, props.skillName));
    flash(t('external.resume'), 'success');
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function confirmLicense(): Promise<void> {
  if (!licenseBasis.value.trim()) {
    flash(t('external.licenseConfirmRequired'), 'error');
    return;
  }
  busy.value = true;
  try {
    applyReference(
      await confirmExternalLicense(props.scope, props.skillName, { basis: licenseBasis.value.trim() })
    );
    flash(t('external.confirmLicense'), 'success');
  } catch (error) {
    flash(formatRequestError(error), 'error');
  } finally {
    busy.value = false;
  }
}

function openEditSource(): void {
  editUrl.value = reference.value?.repositoryUrl ?? '';
  editDirectory.value = normalizedDirectory();
  editPreview.value = null;
  editLicensePath.value = '';
  editConfirmLicense.value = false;
  editError.value = '';
  previewedEditUrl.value = '';
  previewedEditDirectory.value = '';
  editVisible.value = true;
}

async function previewEdit(): Promise<void> {
  if (!reference.value) return;
  editLoading.value = true;
  editError.value = '';
  try {
    editPreview.value = await previewExternalReference({
      scope: props.scope,
      repositoryUrl: editUrl.value,
      branch: reference.value.branch,
      skillDirectory: normalizeEditDirectory()
    });
    previewedEditUrl.value = editUrl.value.trim();
    previewedEditDirectory.value = normalizeEditDirectory();
    editLicensePath.value =
      editPreview.value.licenseProvenance?.path ??
      editPreview.value.licenseCandidates[0]?.path ??
      '';
    editConfirmLicense.value = false;
  } catch (error) {
    editPreview.value = null;
    editError.value = formatRequestError(error);
  } finally {
    editLoading.value = false;
  }
}

function editExtraFiles(): string[] {
  const candidate = editPreview.value?.licenseCandidates.find(
    (item) => item.path === editLicensePath.value
  );
  return candidate && !candidate.insideSkillDirectory ? [candidate.path] : [];
}

async function saveSource(): Promise<void> {
  if (!reference.value) return;
  const nextUrl = editUrl.value.trim();
  const nextDirectory = normalizeEditDirectory();
  if (!nextUrl) {
    editError.value = t('external.sourceUrlRequired');
    return;
  }
  // 来源地址和目录均未变时无需重新验证来源，直接关闭。
  if (nextUrl === reference.value.repositoryUrl && nextDirectory === normalizedDirectory()) {
    editVisible.value = false;
    return;
  }
  if (
    !editPreview.value ||
    previewedEditUrl.value !== nextUrl ||
    previewedEditDirectory.value !== nextDirectory
  ) {
    editError.value = t('external.previewRequired');
    return;
  }
  editLoading.value = true;
  editError.value = '';
  try {
    const updated = await updateExternalReference(props.scope, props.skillName, {
      repositoryUrl: nextUrl,
      skillDirectory: nextDirectory,
      extraFiles: editExtraFiles(),
      confirmLicense: editConfirmLicense.value && Boolean(editPreview.value.detectedLicense)
    });
    applyReference(updated);
    editVisible.value = false;
    flash(t('external.sourceSaved'), 'success');
  } catch (error) {
    // 验证失败保留原配置；服务端未写入任何变更。
    editError.value = formatRequestError(error);
  } finally {
    editLoading.value = false;
  }
}

onMounted(load);

// 移除引用沿用既有治理：先归档，再在既有生命周期面板按权限与确认流程删除整个
// 技能（ADR-0074），不新增绕过删除权限的入口。
function openLifecycle(): void {
  void router.push(skillLocation.value);
}

// 测试接缝：暴露草稿状态与操作方法，便于不依赖 el-select 内部 DOM 结构地驱动。
defineExpose({
  draft,
  load,
  licenseBasis,
  editUrl,
  editDirectory,
  editPreview,
  openEditSource,
  previewEdit,
  saveSource
});
</script>

<style scoped>
.readonly-alert {
  margin: 12px 0;
}

.section-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.error-text {
  color: var(--el-color-danger);
}

.license-confirm-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.config-label {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.config-actions {
  margin-top: 16px;
}

.remove-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0 0 12px;
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.edit-preview {
  margin-top: 12px;
}

.provenance {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.candidate-block {
  margin-top: 12px;
}

.candidate-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.candidate-option {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.candidate-tag {
  margin-left: 8px;
}

.confirm-license {
  margin-top: 12px;
}

.edit-error {
  margin-top: 12px;
}

.license-text {
  max-height: 160px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 8px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  white-space: pre-wrap;
}
</style>

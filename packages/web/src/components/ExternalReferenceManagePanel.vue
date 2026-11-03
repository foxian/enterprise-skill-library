<template>
  <div data-test="external-manage-panel">
    <div class="console-toolbar">
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

    <el-card class="section-card" data-test="external-source-card" v-loading="loading">
      <template #header>{{ t('external.source') }}</template>
      <el-descriptions :column="1" border>
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
      <el-descriptions :column="1" border>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLocaleState, formatRequestError } from '../i18n/locale';
import {
  confirmExternalLicense,
  getExternalReference,
  pauseExternalReference,
  resumeExternalReference,
  syncExternalReference,
  updateExternalReference,
  type ExternalReferenceView,
  type ExternalSyncState
} from '../skills/external-references';

const props = defineProps<{ scope: string; skillName: string }>();
const { t, formatDate } = useLocaleState();
const router = useRouter();

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

function shortCommit(value?: string | null): string {
  return value ? value.slice(0, 8) : '—';
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

onMounted(load);

// 移除引用沿用既有治理：先归档，再在既有生命周期面板按权限与确认流程删除整个
// 技能（ADR-0074），不新增绕过删除权限的入口。
function openLifecycle(): void {
  void router.push({ name: 'me-skill-manage', params: { scope: props.scope, skillName: props.skillName } });
}

// 测试接缝：暴露草稿状态与操作方法，便于不依赖 el-select 内部 DOM 结构地驱动。
defineExpose({ draft, load, licenseBasis });
</script>

<style scoped>
.readonly-alert {
  margin: 12px 0;
}

.section-card {
  margin-bottom: 16px;
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
</style>

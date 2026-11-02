<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('external.create')"
    width="640px"
    data-test="external-create-dialog"
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    @close="emit('update:modelValue', false)"
  >
    <el-form label-position="top" data-test="external-create-form">
      <el-form-item :label="t('external.scope')">
        <el-select v-model="form.scope" data-test="external-scope" style="width: 100%">
          <el-option
            v-for="namespace in namespaces"
            :key="namespace"
            :label="`@${namespace}`"
            :value="namespace"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('external.shortName')">
        <el-input v-model="form.shortName" data-test="external-short-name" />
      </el-form-item>
      <el-form-item :label="t('external.repositoryUrl')">
        <el-input v-model="form.repositoryUrl" data-test="external-repository-url" />
        <div class="form-hint">{{ t('external.repositoryUrlHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.branch')">
        <el-input v-model="form.branch" data-test="external-branch" :placeholder="t('external.preview')" />
        <div class="form-hint">{{ t('external.branchHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.skillDirectory')">
        <el-input v-model="form.skillDirectory" data-test="external-skill-directory" />
        <div class="form-hint">{{ t('external.skillDirectoryHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.extraFiles')">
        <el-input
          v-model="extraFilesText"
          type="textarea"
          :rows="2"
          data-test="external-extra-files"
        />
        <div class="form-hint">{{ t('external.extraFilesHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.visibility')">
        <el-radio-group v-model="form.visibility" data-test="external-visibility">
          <el-radio value="private">{{ t('external.visibilityPrivate') }}</el-radio>
          <el-radio value="public">{{ t('external.visibilityPublic') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('external.schedule')">
        <div class="schedule-row">
          <el-select v-model="form.schedule.frequency" data-test="external-frequency" style="width: 120px">
            <el-option :label="t('external.daily')" value="daily" />
            <el-option :label="t('external.weekly')" value="weekly" />
            <el-option :label="t('external.monthly')" value="monthly" />
          </el-select>
          <el-select
            v-if="form.schedule.frequency === 'weekly'"
            v-model="form.schedule.weekday"
            data-test="external-weekday"
            style="width: 120px"
          >
            <el-option v-for="day in weekOptions" :key="day.value" :label="t(day.label)" :value="day.value" />
          </el-select>
          <el-input
            v-if="form.schedule.frequency === 'monthly'"
            v-model.number="form.schedule.dayOfMonth"
            type="number"
            min="1"
            max="31"
            data-test="external-day"
            style="width: 120px"
          />
          <el-input v-model="form.schedule.time" data-test="external-time" style="width: 120px" />
          <el-input v-model="form.schedule.timeZone" data-test="external-timezone" style="width: 180px" />
        </div>
      </el-form-item>
    </el-form>

    <el-alert
      v-if="previewResult"
      type="info"
      :closable="false"
      class="preview-alert"
      data-test="external-preview-alert"
    >
      <template #title>
        {{ previewResult.detectedLicense
          ? `${t('external.detectedLicense')}: ${previewResult.detectedLicense}`
          : t('external.noLicenseDetected') }}
      </template>
      <div class="preview-files">{{ previewResult.files.join(', ') }}</div>
    </el-alert>
    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      :closable="false"
      class="preview-alert"
      data-test="external-create-error"
    />

    <template #footer>
      <el-button data-test="external-cancel" @click="emit('update:modelValue', false)">
        {{ t('common.cancel') }}
      </el-button>
      <el-button data-test="external-preview-btn" :loading="loading" @click="runPreview">
        {{ t('external.preview') }}
      </el-button>
      <el-button
        type="primary"
        data-test="external-submit"
        :loading="loading"
        @click="submit"
      >
        {{ t('external.create') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useLocaleState, formatRequestError } from '../i18n/locale';
import { useAuthStore } from '../stores/auth';
import {
  createExternalReference,
  previewExternalReference,
  type ExternalPreviewResult
} from '../skills/external-references';

const { t } = useLocaleState();
const auth = useAuthStore();

const props = defineProps<{
  modelValue: boolean;
  // 可选：默认归属命名空间（锁定组织视图时预置）。
  defaultNamespace?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [boolean];
  created: [string];
}>();

interface FormState {
  scope: string;
  shortName: string;
  repositoryUrl: string;
  branch: string;
  skillDirectory: string;
  visibility: 'private' | 'public';
  schedule: {
    frequency: 'daily' | 'weekly' | 'monthly';
    time: string;
    timeZone: string;
    weekday: number;
    dayOfMonth: number;
  };
}

function initialForm(): FormState {
  return {
    scope: props.defaultNamespace ?? auth.username ?? 'local',
    shortName: '',
    repositoryUrl: '',
    branch: '',
    skillDirectory: '',
    visibility: 'private',
    schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1 }
  };
}

const form = reactive<FormState>(initialForm());
const extraFilesText = ref('');
const loading = ref(false);
const errorMessage = ref('');
const previewResult = ref<ExternalPreviewResult | null>(null);

// 可归属的命名空间：自己 + 所在组织。
const namespaces = computed<string[]>(() =>
  [auth.username, ...auth.organizations.map((org) => org.org)].filter(
    (value): value is string => Boolean(value)
  )
);

const weekOptions = [
  { value: 1, label: 'external.mon' },
  { value: 2, label: 'external.tue' },
  { value: 3, label: 'external.wed' },
  { value: 4, label: 'external.thu' },
  { value: 5, label: 'external.fri' },
  { value: 6, label: 'external.sat' },
  { value: 7, label: 'external.sun' }
] as const;

function extraFiles(): string[] {
  return extraFilesText.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildSchedule() {
  const { frequency, time, timeZone, weekday, dayOfMonth } = form.schedule;
  const base = { frequency, time, timeZone };
  if (frequency === 'weekly') return { ...base, weekday };
  if (frequency === 'monthly') return { ...base, dayOfMonth };
  return base;
}

async function runPreview(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    previewResult.value = await previewExternalReference({
      repositoryUrl: form.repositoryUrl,
      branch: form.branch || undefined,
      skillDirectory: form.skillDirectory || undefined,
      extraFiles: extraFiles()
    });
    if (!form.branch) form.branch = previewResult.value.branch;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const created = await createExternalReference({
      scope: form.scope,
      shortName: form.shortName,
      repositoryUrl: form.repositoryUrl,
      branch: form.branch || undefined,
      skillDirectory: form.skillDirectory || undefined,
      extraFiles: extraFiles(),
      visibility: form.visibility,
      schedule: buildSchedule()
    });
    emit('created', created.skillName);
    emit('update:modelValue', false);
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.schedule-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preview-alert {
  margin-top: 12px;
}

.preview-files {
  font-size: 12px;
  word-break: break-all;
}
</style>

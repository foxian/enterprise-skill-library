<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('external.create')"
    width="640px"
    class="external-create-dialog"
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
      <el-form-item :label="t('external.repositoryUrl')">
        <el-input v-model="form.repositoryUrl" data-test="external-repository-url" />
        <div class="form-hint">{{ t('external.repositoryUrlHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.skillLocation')">
        <el-radio-group v-model="form.skillLocation" data-test="external-skill-location">
          <el-radio value="root">{{ t('external.repositoryRoot') }}</el-radio>
          <el-radio value="subdirectory">{{ t('external.repositorySubdirectory') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item
        v-if="form.skillLocation === 'subdirectory'"
        :label="t('external.skillDirectory')"
      >
        <el-input
          v-model="form.skillDirectory"
          data-test="external-skill-directory"
          :placeholder="t('external.skillDirectoryPlaceholder')"
        />
        <div class="form-hint">{{ t('external.skillDirectoryHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('external.branch')">
        <el-input v-model="form.branch" data-test="external-branch" :placeholder="t('external.preview')" />
        <div class="form-hint">{{ t('external.branchHint') }}</div>
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

    <el-card v-if="previewResult" class="preview-card" data-test="external-preview-alert">
      <template #header>{{ t('external.previewResult') }}</template>
      <el-descriptions :column="1" border label-width="96px">
        <el-descriptions-item :label="t('external.skillName')">
          <code data-test="external-preview-name">{{ previewResult.skillName }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.description')">
          <span data-test="external-preview-description">
            {{ previewResult.description || t('external.noDescription') }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.branch')">
          <code>{{ previewResult.branch }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('external.license')">
          <span data-test="external-preview-license">
            {{
              previewResult.detectedLicense
                ? `${t('external.detectedLicense')}: ${previewResult.detectedLicense}`
                : t('external.noLicenseDetected')
            }}
          </span>
          <span v-if="previewResult.licenseProvenance" class="provenance">
            {{ previewResult.licenseProvenance.path }}
          </span>
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="previewResult.licenseCandidates.length > 0" class="candidate-block">
        <div class="candidate-title">{{ t('external.licenseCandidates') }}</div>
        <el-radio-group v-model="selectedLicensePath" data-test="external-license-candidates">
          <el-radio
            v-for="candidate in previewResult.licenseCandidates"
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
        <div class="form-hint">{{ t('external.licenseCandidateHint') }}</div>
        <pre v-if="selectedCandidate" class="license-text">{{ selectedCandidate.text }}</pre>
      </div>

      <el-checkbox
        v-if="previewResult.detectedLicense"
        v-model="confirmLicense"
        data-test="external-confirm-license"
        class="confirm-license"
      >
        {{ t('external.confirmLicenseCheckbox') }}
      </el-checkbox>
      <el-alert
        v-else
        type="warning"
        :closable="false"
        :title="t('external.licenseNotDetectedHint')"
        class="preview-alert"
      />
    </el-card>

    <el-alert
      v-if="previewResult?.nameConflict"
      type="error"
      :title="t('external.nameConflict')"
      :closable="false"
      class="preview-alert"
      data-test="external-name-conflict"
    >
      <el-button size="small" data-test="external-open-existing" @click="openExistingSkill">
        {{ t('external.openExistingSkill') }}
      </el-button>
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
import { computed, nextTick, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLocaleState, formatRequestError } from '../i18n/locale';
import { useAuthStore } from '../stores/auth';
import {
  createExternalReference,
  previewExternalReference,
  type ExternalPreviewResult
} from '../skills/external-references';

const { t } = useLocaleState();
const auth = useAuthStore();
const router = useRouter();

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
  repositoryUrl: string;
  skillLocation: 'root' | 'subdirectory';
  skillDirectory: string;
  branch: string;
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
    repositoryUrl: '',
    skillLocation: 'subdirectory',
    skillDirectory: '',
    branch: '',
    visibility: 'private',
    schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1 }
  };
}

const form = reactive<FormState>(initialForm());
const loading = ref(false);
const errorMessage = ref('');
const previewResult = ref<ExternalPreviewResult | null>(null);
const selectedLicensePath = ref('');
const confirmLicense = ref(false);
// 预览时的输入快照：提交前若来源字段变化，要求重新预览，避免创建与预览不一致。
const previewedSource = ref('');

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

const skillDirectory = computed(() =>
  form.skillLocation === 'subdirectory' ? form.skillDirectory.trim() : ''
);

const selectedCandidate = computed(() =>
  previewResult.value?.licenseCandidates.find(
    (candidate) => candidate.path === selectedLicensePath.value
  )
);

function sourceSnapshot(): string {
  return JSON.stringify({
    repositoryUrl: form.repositoryUrl.trim(),
    branch: form.branch.trim(),
    skillDirectory: skillDirectory.value
  });
}

function buildSchedule() {
  const { frequency, time, timeZone, weekday, dayOfMonth } = form.schedule;
  const base = { frequency, time, timeZone };
  if (frequency === 'weekly') return { ...base, weekday };
  if (frequency === 'monthly') return { ...base, dayOfMonth };
  return base;
}

// 目录外许可文件必须显式选入；目录内候选已随技能内容打包。
function extraFiles(): string[] {
  const candidate = selectedCandidate.value;
  return candidate && !candidate.insideSkillDirectory ? [candidate.path] : [];
}

async function runPreview(): Promise<void> {
  errorMessage.value = '';
  if (form.skillLocation === 'subdirectory' && !form.skillDirectory.trim()) {
    errorMessage.value = t('external.skillDirectoryRequired');
    return;
  }
  loading.value = true;
  try {
    previewResult.value = await previewExternalReference({
      scope: form.scope,
      repositoryUrl: form.repositoryUrl,
      branch: form.branch || undefined,
      skillDirectory: skillDirectory.value || undefined
    });
    if (!form.branch) form.branch = previewResult.value.branch;
    previewedSource.value = sourceSnapshot();
    selectedLicensePath.value =
      previewResult.value.licenseProvenance?.path ??
      previewResult.value.licenseCandidates[0]?.path ??
      '';
    confirmLicense.value = false;
    // 预览结果位于表单下方，自动滚动到结果卡片，避免用户误以为没有响应。
    await nextTick();
    document
      .querySelector('[data-test="external-preview-alert"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  } catch (error) {
    previewResult.value = null;
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
}

function openExistingSkill(): void {
  if (!previewResult.value) return;
  emit('update:modelValue', false);
  void router.push({
    name: previewResult.value.existingExternal ? 'me-external-manage' : 'me-skill-manage',
    params: { scope: form.scope, skillName: previewResult.value.skillName }
  });
}

async function submit(): Promise<void> {
  errorMessage.value = '';
  if (!previewResult.value) {
    errorMessage.value = t('external.previewRequired');
    return;
  }
  if (previewedSource.value !== sourceSnapshot()) {
    errorMessage.value = t('external.previewChanged');
    return;
  }
  if (previewResult.value.nameConflict) {
    errorMessage.value = t('external.nameConflict');
    return;
  }
  loading.value = true;
  try {
    const created = await createExternalReference({
      scope: form.scope,
      repositoryUrl: form.repositoryUrl,
      branch: form.branch || undefined,
      skillDirectory: skillDirectory.value || undefined,
      extraFiles: extraFiles(),
      visibility: form.visibility,
      schedule: buildSchedule(),
      confirmLicense: confirmLicense.value && Boolean(previewResult.value.detectedLicense)
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

.preview-card {
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

.license-text {
  max-height: 160px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 8px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  white-space: pre-wrap;
}

.confirm-license {
  margin-top: 12px;
}
</style>

<style>
/* 非 scoped：Element Plus 对话框内部结构不受 scoped 属性约束；用组件专属
   class 限定范围，避免影响其他对话框。 */
.external-create-dialog .el-dialog__body {
  max-height: 62vh;
  overflow-y: auto;
}
</style>

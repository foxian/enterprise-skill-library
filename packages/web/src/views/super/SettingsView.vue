<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-form label-width="160px" class="settings-form">
        <el-form-item :label="t('settings.userRegistrationMode')">
          <el-radio-group v-model="registrationMode" data-test="user-registration-mode">
            <el-radio value="open">{{ t('settings.openRegistration') }}</el-radio>
            <el-radio value="approval">{{ t('settings.approvalRegistration') }}</el-radio>
          </el-radio-group>
          <div class="form-hint">
            {{ t('settings.approvalRegistrationHint') }}
          </div>
        </el-form-item>
        <el-form-item :label="t('settings.adminProvisionedPasswordChangePolicy')">
          <el-radio-group
            v-model="adminProvisionedPasswordChangePolicy"
            data-test="admin-provisioned-password-change-policy"
          >
            <el-radio value="force">{{ t('settings.forceAdminPasswordChange') }}</el-radio>
            <el-radio value="allow">{{ t('settings.allowAdminInitialPassword') }}</el-radio>
          </el-radio-group>
          <div class="form-hint">
            {{ t('settings.adminProvisionedPasswordChangePolicyHint') }}
          </div>
        </el-form-item>
        <el-form-item :label="t('settings.orgRegistrationMode')">
          <el-radio-group v-model="orgRegistrationMode" data-test="registration-mode">
            <el-radio value="auto">{{ t('settings.autoOrgRegistration') }}</el-radio>
            <el-radio value="manual">{{ t('settings.manualOrgRegistration') }}</el-radio>
          </el-radio-group>
          <div class="form-hint">
            {{ t('settings.autoOrgRegistrationHint') }}
          </div>
        </el-form-item>
        <el-form-item :label="t('settings.memberAdditionMode')">
          <el-radio-group v-model="memberAddMode" data-test="member-add-mode">
            <el-radio value="direct">{{ t('settings.directAddition') }}</el-radio>
            <el-radio value="invite">{{ t('settings.invitationMode') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('settings.emailVerification')">
          <el-radio-group v-model="emailVerification" data-test="email-verification">
            <el-radio value="off">{{ t('settings.emailVerificationOff') }}</el-radio>
            <el-radio value="on">{{ t('settings.emailVerificationOn') }}</el-radio>
          </el-radio-group>
          <div class="form-hint">{{ t('settings.emailVerificationHint') }}</div>
        </el-form-item>

        <div
          class="smtp-subsidiary"
          :class="{ 'is-disabled': smtpDisabled }"
          data-test="smtp-settings"
        >
          <div class="smtp-subsidiary-header">
            <div class="smtp-subsidiary-title">{{ t('settings.smtpSectionTitle') }}</div>
            <div class="form-hint">{{ t('settings.smtpSectionHint') }}</div>
          </div>
          <el-form label-width="120px" class="smtp-form" @submit.prevent>
            <el-form-item :label="t('settings.smtpHost')">
              <div class="smtp-host-row">
                <el-input
                  v-model="smtpHost"
                  class="smtp-host-input"
                  :disabled="smtpDisabled"
                  data-test="smtp-host"
                />
                <div class="smtp-port-wrap">
                  <span class="smtp-port-label">{{ t('settings.smtpPort') }}</span>
                  <el-input-number
                    v-model="smtpPort"
                    :min="1"
                    :max="65535"
                    :disabled="smtpDisabled"
                    controls-position="right"
                    data-test="smtp-port"
                  />
                </div>
              </div>
            </el-form-item>
            <el-form-item :label="t('settings.smtpUsername')">
              <el-input v-model="smtpUsername" :disabled="smtpDisabled" data-test="smtp-username" />
            </el-form-item>
            <el-form-item :label="t('settings.smtpPassword')">
              <el-input
                v-model="smtpPassword"
                type="password"
                show-password
                :disabled="smtpDisabled"
                :placeholder="smtpPasswordSet ? t('settings.smtpPasswordUnchanged') : ''"
                data-test="smtp-password"
              />
            </el-form-item>
            <el-form-item :label="t('settings.smtpFrom')">
              <el-input v-model="smtpFrom" :disabled="smtpDisabled" data-test="smtp-from" />
            </el-form-item>
            <el-form-item :label="t('settings.smtpReplyTo')">
              <el-input v-model="smtpReplyTo" :disabled="smtpDisabled" data-test="smtp-reply-to" />
            </el-form-item>
          </el-form>
        </div>

        <el-form-item>
          <el-button
            type="primary"
            data-test="save-settings"
            :loading="saving"
            :disabled="!hasChanges"
            @click="handleSave"
          >
            {{ t('common.save') }}
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

const { t } = useLocaleState();

type RegistrationMode = 'auto' | 'manual';
type UserRegistrationMode = 'open' | 'approval';
type MemberAddMode = 'direct' | 'invite';
type AdminProvisionedPasswordChangePolicy = 'force' | 'allow';
type EmailVerification = 'off' | 'on';

interface PlatformSettings {
  orgRegistrationMode: RegistrationMode;
  registrationMode: UserRegistrationMode;
  memberAddMode: MemberAddMode;
  adminProvisionedPasswordChangePolicy: AdminProvisionedPasswordChangePolicy;
  emailVerification: EmailVerification;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpFrom: string;
  smtpReplyTo: string;
  smtpPasswordSet: boolean;
}

function normalizeSettings(settings: Partial<PlatformSettings>): PlatformSettings {
  return {
    orgRegistrationMode: settings.orgRegistrationMode ?? 'auto',
    registrationMode: settings.registrationMode ?? 'open',
    memberAddMode: settings.memberAddMode ?? 'direct',
    adminProvisionedPasswordChangePolicy: settings.adminProvisionedPasswordChangePolicy ?? 'force',
    emailVerification: settings.emailVerification ?? 'off',
    smtpHost: settings.smtpHost ?? '',
    smtpPort: settings.smtpPort ?? 465,
    smtpUsername: settings.smtpUsername ?? '',
    smtpFrom: settings.smtpFrom ?? '',
    smtpReplyTo: settings.smtpReplyTo ?? '',
    smtpPasswordSet: settings.smtpPasswordSet ?? false
  };
}

const orgRegistrationMode = ref<RegistrationMode>('auto');
const registrationMode = ref<UserRegistrationMode>('open');
const memberAddMode = ref<MemberAddMode>('direct');
const adminProvisionedPasswordChangePolicy = ref<AdminProvisionedPasswordChangePolicy>('force');
const emailVerification = ref<EmailVerification>('off');
const smtpHost = ref('');
const smtpPort = ref(465);
const smtpUsername = ref('');
const smtpPassword = ref('');
const smtpFrom = ref('');
const smtpReplyTo = ref('');
const smtpPasswordSet = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const saved = ref<PlatformSettings>({
  orgRegistrationMode: 'auto',
  registrationMode: 'open',
  memberAddMode: 'direct',
  adminProvisionedPasswordChangePolicy: 'force',
  emailVerification: 'off',
  smtpHost: '',
  smtpPort: 465,
  smtpUsername: '',
  smtpFrom: '',
  smtpReplyTo: '',
  smtpPasswordSet: false
});

const smtpDisabled = computed(() => emailVerification.value !== 'on');

const hasChanges = computed(() => (
  orgRegistrationMode.value !== saved.value.orgRegistrationMode
  || registrationMode.value !== saved.value.registrationMode
  || memberAddMode.value !== saved.value.memberAddMode
  || adminProvisionedPasswordChangePolicy.value !== saved.value.adminProvisionedPasswordChangePolicy
  || emailVerification.value !== saved.value.emailVerification
  || smtpHost.value !== saved.value.smtpHost
  || smtpPort.value !== saved.value.smtpPort
  || smtpUsername.value !== saved.value.smtpUsername
  || smtpFrom.value !== saved.value.smtpFrom
  || smtpReplyTo.value !== saved.value.smtpReplyTo
  || smtpPassword.value.trim().length > 0
));

// 拉人方式是平台设置，与 /api/admin/orgs/settings 同一读写面（ADR-0032）
async function load(): Promise<void> {
  errorMessage.value = '';
  try {
    const settings = normalizeSettings(await apiRequest<Partial<PlatformSettings>>('/api/admin/orgs/settings'));
    saved.value = settings;
    orgRegistrationMode.value = saved.value.orgRegistrationMode;
    registrationMode.value = saved.value.registrationMode;
    memberAddMode.value = saved.value.memberAddMode;
    adminProvisionedPasswordChangePolicy.value = saved.value.adminProvisionedPasswordChangePolicy;
    emailVerification.value = saved.value.emailVerification;
    smtpHost.value = saved.value.smtpHost;
    smtpPort.value = saved.value.smtpPort;
    smtpUsername.value = saved.value.smtpUsername;
    smtpFrom.value = saved.value.smtpFrom;
    smtpReplyTo.value = saved.value.smtpReplyTo;
    smtpPasswordSet.value = saved.value.smtpPasswordSet;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function handleSave(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    const settings = normalizeSettings(await apiRequest<Partial<PlatformSettings>>('/api/admin/orgs/settings', {
      method: 'PUT',
      body: {
        orgRegistrationMode: orgRegistrationMode.value,
        registrationMode: registrationMode.value,
        memberAddMode: memberAddMode.value,
        adminProvisionedPasswordChangePolicy: adminProvisionedPasswordChangePolicy.value,
        emailVerification: emailVerification.value,
        smtpHost: smtpHost.value,
        smtpPort: smtpPort.value,
        smtpUsername: smtpUsername.value,
        ...(smtpPassword.value ? { smtpPassword: smtpPassword.value } : {}),
        smtpFrom: smtpFrom.value,
        smtpReplyTo: smtpReplyTo.value
      }
    }));
    saved.value = {
      orgRegistrationMode: settings.orgRegistrationMode,
      registrationMode: settings.registrationMode,
      memberAddMode: settings.memberAddMode,
      adminProvisionedPasswordChangePolicy: settings.adminProvisionedPasswordChangePolicy,
      emailVerification: settings.emailVerification,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpUsername: settings.smtpUsername,
      smtpFrom: settings.smtpFrom,
      smtpReplyTo: settings.smtpReplyTo,
      smtpPasswordSet: settings.smtpPasswordSet
    };
    orgRegistrationMode.value = settings.orgRegistrationMode;
    registrationMode.value = settings.registrationMode;
    memberAddMode.value = settings.memberAddMode;
    adminProvisionedPasswordChangePolicy.value = settings.adminProvisionedPasswordChangePolicy;
    emailVerification.value = settings.emailVerification;
    smtpHost.value = settings.smtpHost;
    smtpPort.value = settings.smtpPort;
    smtpUsername.value = settings.smtpUsername;
    smtpFrom.value = settings.smtpFrom;
    smtpReplyTo.value = settings.smtpReplyTo;
    smtpPasswordSet.value = settings.smtpPasswordSet;
    smtpPassword.value = '';
    ElMessage.success(t('settings.saved'));
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-form {
  max-width: 720px;
}

.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}

.smtp-subsidiary {
  margin: 4px 0 24px 160px;
  padding: 16px 18px 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  transition: opacity 0.2s ease;
}

.smtp-subsidiary.is-disabled {
  opacity: 0.72;
}

.smtp-subsidiary-header {
  margin-bottom: 12px;
}

.smtp-subsidiary-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.smtp-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.smtp-form :deep(.el-form-item__label) {
  color: var(--el-text-color-regular);
}

.smtp-host-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.smtp-host-input {
  flex: 1;
  min-width: 0;
}

.smtp-port-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.smtp-port-label {
  color: var(--el-text-color-regular);
  font-size: 14px;
  white-space: nowrap;
}

.smtp-port-wrap :deep(.el-input-number) {
  width: 120px;
}

@media (max-width: 768px) {
  .smtp-subsidiary {
    margin-left: 0;
  }

  .smtp-host-row {
    flex-direction: column;
    align-items: stretch;
  }

  .smtp-port-wrap {
    justify-content: space-between;
  }

  .smtp-port-wrap :deep(.el-input-number) {
    width: 140px;
  }
}
</style>

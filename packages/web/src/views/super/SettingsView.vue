<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-form label-width="160px">
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
        <el-form-item :label="t('settings.smtpHost')">
          <el-input v-model="smtpHost" data-test="smtp-host" />
        </el-form-item>
        <el-form-item :label="t('settings.smtpPort')">
          <el-input-number v-model="smtpPort" :min="1" :max="65535" data-test="smtp-port" />
        </el-form-item>
        <el-form-item :label="t('settings.smtpUsername')">
          <el-input v-model="smtpUsername" data-test="smtp-username" />
        </el-form-item>
        <el-form-item :label="t('settings.smtpPassword')">
          <el-input v-model="smtpPassword" type="password" show-password :placeholder="smtpPasswordSet ? t('settings.smtpPasswordUnchanged') : ''" data-test="smtp-password" />
        </el-form-item>
        <el-form-item :label="t('settings.smtpFrom')">
          <el-input v-model="smtpFrom" data-test="smtp-from" />
        </el-form-item>
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
    smtpPort: settings.smtpPort ?? 587,
    smtpUsername: settings.smtpUsername ?? '',
    smtpFrom: settings.smtpFrom ?? '',
    smtpPasswordSet: settings.smtpPasswordSet ?? false
  };
}

const orgRegistrationMode = ref<RegistrationMode>('auto');
const registrationMode = ref<UserRegistrationMode>('open');
const memberAddMode = ref<MemberAddMode>('direct');
const adminProvisionedPasswordChangePolicy = ref<AdminProvisionedPasswordChangePolicy>('force');
const emailVerification = ref<EmailVerification>('off');
const smtpHost = ref('');
const smtpPort = ref(587);
const smtpUsername = ref('');
const smtpPassword = ref('');
const smtpFrom = ref('');
const smtpPasswordSet = ref(false);
const saved = ref<PlatformSettings>({
  orgRegistrationMode: 'auto',
  registrationMode: 'open',
  memberAddMode: 'direct',
  adminProvisionedPasswordChangePolicy: 'force',
  emailVerification: 'off',
  smtpHost: '',
  smtpPort: 587,
  smtpUsername: '',
  smtpFrom: '',
  smtpPasswordSet: false
});
const saving = ref(false);
const errorMessage = ref('');

const hasChanges = computed(() => {
  return (
    orgRegistrationMode.value !== saved.value.orgRegistrationMode ||
    registrationMode.value !== saved.value.registrationMode ||
    memberAddMode.value !== saved.value.memberAddMode ||
    adminProvisionedPasswordChangePolicy.value !== saved.value.adminProvisionedPasswordChangePolicy ||
    emailVerification.value !== saved.value.emailVerification
    || smtpHost.value !== saved.value.smtpHost
    || smtpPort.value !== saved.value.smtpPort
    || smtpUsername.value !== saved.value.smtpUsername
    || smtpFrom.value !== saved.value.smtpFrom
    || smtpPassword.value.trim().length > 0
  );
});

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
        smtpFrom: smtpFrom.value
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
.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}
</style>

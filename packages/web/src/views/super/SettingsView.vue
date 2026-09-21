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

interface PlatformSettings {
  orgRegistrationMode: RegistrationMode;
  registrationMode: UserRegistrationMode;
  memberAddMode: MemberAddMode;
}

const orgRegistrationMode = ref<RegistrationMode>('auto');
const registrationMode = ref<UserRegistrationMode>('open');
const memberAddMode = ref<MemberAddMode>('direct');
const saved = ref<PlatformSettings>({
  orgRegistrationMode: 'auto',
  registrationMode: 'open',
  memberAddMode: 'direct'
});
const saving = ref(false);
const errorMessage = ref('');

const hasChanges = computed(() => {
  return (
    orgRegistrationMode.value !== saved.value.orgRegistrationMode ||
    registrationMode.value !== saved.value.registrationMode ||
    memberAddMode.value !== saved.value.memberAddMode
  );
});

// 拉人方式是平台设置，与 /api/admin/orgs/settings 同一读写面（ADR-0032）
async function load(): Promise<void> {
  errorMessage.value = '';
  try {
    const settings = await apiRequest<PlatformSettings>('/api/admin/orgs/settings');
    saved.value = settings;
    orgRegistrationMode.value = saved.value.orgRegistrationMode;
    registrationMode.value = saved.value.registrationMode;
    memberAddMode.value = saved.value.memberAddMode;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  }
}

async function handleSave(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    const settings = await apiRequest<PlatformSettings>('/api/admin/orgs/settings', {
      method: 'PUT',
      body: {
        orgRegistrationMode: orgRegistrationMode.value,
        registrationMode: registrationMode.value,
        memberAddMode: memberAddMode.value
      }
    });
    saved.value = {
      orgRegistrationMode: settings.orgRegistrationMode,
      registrationMode: settings.registrationMode,
      memberAddMode: memberAddMode.value
    };
    orgRegistrationMode.value = settings.orgRegistrationMode;
    registrationMode.value = settings.registrationMode;
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

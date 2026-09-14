<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-form label-width="160px">
        <el-form-item label="用户注册模式">
          <el-radio-group v-model="registrationMode" data-test="user-registration-mode">
            <el-radio value="open">开放注册（注册即可用）</el-radio>
            <el-radio value="approval">需要审批（批准后激活）</el-radio>
          </el-radio-group>
          <div class="form-hint">
            审批模式下账号注册后处于待审批状态，在「注册审批」中批准或拒绝。
          </div>
        </el-form-item>
        <el-form-item label="组织注册审批模式">
          <el-radio-group v-model="orgRegistrationMode" data-test="registration-mode">
            <el-radio value="auto">免审批（即时创建）</el-radio>
            <el-radio value="manual">需要审批</el-radio>
          </el-radio-group>
          <div class="form-hint">
            免审批时任何注册用户可即时创建组织；需要审批时走组织注册申请。
          </div>
        </el-form-item>
        <el-form-item label="拉人方式">
          <el-radio-group v-model="memberAddMode" data-test="member-add-mode">
            <el-radio value="direct">直接添加（即时入组）</el-radio>
            <el-radio value="invite">邀请制（对方接受后入组）</el-radio>
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
            保存
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

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
    errorMessage.value = error instanceof Error ? error.message : String(error);
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
    ElMessage.success('平台设置已保存');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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

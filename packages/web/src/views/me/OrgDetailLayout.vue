<template>
  <div>
    <div class="org-identity">
      <span class="org-name" data-test="org-identity">@{{ org }}</span>
      <el-tag type="primary" size="small">组织管理团队</el-tag>
    </div>
    <el-tabs :model-value="activeTab" @update:model-value="selectTab">
      <el-tab-pane label="成员" name="members" />
      <el-tab-pane label="团队" name="teams" />
      <el-tab-pane label="技能" name="skills" />
    </el-tabs>
    <router-view />

    <!-- 组织删除（ADR-0034）：组织管理团队成员即可发起，手打组织名确认 -->
    <el-card class="danger-zone" data-test="org-danger-zone">
      <template #header>危险操作</template>
      <p class="danger-hint">
        删除组织将移除其全部技能仓库与关联数据（成员是全局账号，不受影响），操作不可恢复。
        组织名会在删除完成后回到名字池，可被重新占用。
      </p>
      <el-input
        v-model="confirmInput"
        data-test="org-delete-confirm-input"
        placeholder="请输入组织名以确认删除"
        class="danger-input"
      />
      <el-button
        type="danger"
        data-test="org-delete-button"
        :disabled="confirmInput !== org || deleting"
        :loading="deleting"
        @click="deleteOrg"
      >
        彻底删除组织
      </el-button>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

// 组织详情：成员 / 团队 / 技能三个页签（ADR-0035）。没有"设置"页签——组织名
// 不可改名（ADR-0032）是既定事实，不是被藏起来的功能。
const route = useRoute();
const router = useRouter();

const org = computed<string>(() => String(route.params.org ?? ''));

const activeTab = computed<string>(() => {
  const name = String(route.name ?? '');
  if (name.endsWith('teams')) return 'teams';
  if (name.endsWith('skills')) return 'skills';
  return 'members';
});

function selectTab(tab: string | number): void {
  const name = `me-org-${String(tab)}`;
  if (name !== route.name) {
    void router.push({ name, params: { org: org.value } });
  }
}

const confirmInput = ref('');
const deleting = ref(false);
const errorMessage = ref('');

async function deleteOrg(): Promise<void> {
  errorMessage.value = '';
  deleting.value = true;
  try {
    await apiRequest(`/api/orgs/${encodeURIComponent(org.value)}`, {
      method: 'DELETE',
      body: { confirm: confirmInput.value }
    });
    ElMessage.success(`组织 ${org.value} 已删除`);
    await router.push({ name: 'me-orgs' });
  } catch (error) {
    // 删除失败（如 Git Backend 有外部资源）不是死局：状态会落成 delete_failed，
    // 组织列表页带着失败原因再做重试。
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.org-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.org-name {
  font-size: 18px;
  font-weight: 600;
}

.danger-zone {
  margin-top: 24px;
}

.danger-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}

.danger-input {
  max-width: 320px;
  margin-bottom: 12px;
}

.page-error {
  margin-top: 16px;
}
</style>

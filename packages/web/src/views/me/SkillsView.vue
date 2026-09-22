<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <span class="toolbar-caption">
          {{ lockedNamespace ? t('skill.namespaceSkills', { namespace: lockedNamespace }) : t('skill.mySkills') }}
        </span>
        <!-- 锁定视图（组织详情页的「技能」页签）不再提供筛选器：范围由路由决定 -->
        <el-select
          v-if="!lockedNamespace"
          v-model="namespaceFilter"
          data-test="namespace-filter"
          :placeholder="t('skill.namespacePlaceholder')"
          clearable
          style="width: 220px"
        >
          <el-option v-for="scope in namespaces" :key="scope" :label="`@${scope}`" :value="scope" />
        </el-select>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="t('skill.managedTab')" name="managed">
          <el-table :data="visibleManagedRows" data-test="skill-list-managed" v-loading="loading">
            <el-table-column :label="t('skill.name')">
              <template #default="{ row }">
                <span v-if="row.displayName" data-test="skill-display-name">{{ row.displayName }}</span>
                <code class="skill-path">{{ row.name }}</code>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.namespace')" width="140">
              <template #default="{ row }">@{{ row.scope }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.ownerRelation')" width="120">
              <template #default>
                <el-tag type="primary" data-test="relation-managed">{{ t('skill.managedTab') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
            <el-table-column :label="t('columns.status')" width="100">
              <template #default="{ row }">{{ t(statusText(row.status)) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.shareStatus')" width="140">
              <template #default="{ row }">
                <el-tag :type="row.state.tagType" :data-test="`skill-state-${row.skillName}`">{{ t(row.state.text) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="140">
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  :data-test="`configure-${row.skillName}`"
                  @click="openPermissions(row.scope, row.skillName)"
                >
                  {{ t('actions.manage') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="t('skill.sharedTab')" name="shared">
          <el-table :data="visibleSharedRows" data-test="skill-list-shared" v-loading="loading">
            <el-table-column :label="t('skill.name')">
              <template #default="{ row }">
                <span v-if="row.displayName" data-test="skill-display-name">{{ row.displayName }}</span>
                <code class="skill-path">{{ row.name }}</code>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.namespace')" width="140">
              <template #default="{ row }">@{{ row.scope }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.ownerRelation')" width="120">
              <template #default>
                <el-tag type="info" data-test="relation-shared">{{ t('skill.sharedTab') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
            <el-table-column :label="t('columns.myPermission')" width="120">
              <template #default="{ row }">
                <el-tag type="info">{{ t(accessText(row.access)) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.status')" width="100">
              <template #default="{ row }">{{ t(statusText(row.status)) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { formatRequestError, useLocaleState } from '../../i18n/locale';
import { useRoute, useRouter } from 'vue-router';
import {
  accessText,
  deriveShareState,
  loadSkillInventorySummaries,
  statusText,
  type PermissionMatrix,
  type SkillInventoryItem
} from '../../skills/skill-list';

const { t } = useLocaleState();

// 技能列表页（ADR-0035）：一处实现，两处入口——个人控制台的「技能」是跨命名
// 空间聚合，组织详情页的「技能」页签是同一列表锁定到该组织命名空间。服务端
// inventory 本就跨命名空间返回，锁定纯属展示层筛选，权限判定同源。
const props = defineProps<{ lockedNamespace?: string }>();

const route = useRoute();
const router = useRouter();

interface ManagedRow extends SkillInventoryItem {
  state: ReturnType<typeof deriveShareState>;
}

const activeTab = ref<'managed' | 'shared'>('managed');
const managedRows = ref<ManagedRow[]>([]);
const sharedRows = ref<SkillInventoryItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
// 跨命名空间聚合（ADR-0032）：个人 + 所有所在组织的技能，可按命名空间筛选；
// 从「我的组织」跳进来时用 ?namespace= 预置筛选。
const namespaceFilter = ref<string>(props.lockedNamespace ?? String(route.query.namespace ?? ''));

watch(
  () => [props.lockedNamespace, route.query.namespace],
  () => {
    namespaceFilter.value = props.lockedNamespace ?? String(route.query.namespace ?? '');
  }
);

const namespaces = computed(() => {
  const scopes = new Set<string>();
  for (const row of [...managedRows.value, ...sharedRows.value]) {
    scopes.add(row.scope);
  }
  return [...scopes].sort();
});

const visibleManagedRows = computed(() =>
  namespaceFilter.value ? managedRows.value.filter((row) => row.scope === namespaceFilter.value) : managedRows.value
);
const visibleSharedRows = computed(() =>
  namespaceFilter.value ? sharedRows.value.filter((row) => row.scope === namespaceFilter.value) : sharedRows.value
);

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'me-skill-manage',
    params: { scope, skillName }
  });
}

// 没有矩阵读取权限(或读取失败)的技能按默认私有展示共享状态
function fallbackMatrix(item: SkillInventoryItem): PermissionMatrix {
  return {
    scope: item.scope,
    skillName: item.skillName,
    sharedAllRead: false,
    sharedAllWrite: false,
    sharedAllManage: false,
    teams: [],
    members: []
  };
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    const items = await loadSkillInventorySummaries();
    managedRows.value = items
      .filter((item) => item.relation === 'managed')
      .map((item) => ({ ...item, state: deriveShareState(item.matrix ?? fallbackMatrix(item)) }));
    sharedRows.value = items.filter((item) => item.relation === 'shared');
  } catch (error) {
    errorMessage.value = formatRequestError(error);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

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
        <el-button
          type="primary"
          data-test="create-external-reference"
          @click="showCreateDialog = true"
        >
          {{ t('external.create') }}
        </el-button>
        <ExternalReferenceCreateDialog
          v-model="showCreateDialog"
          :default-namespace="lockedNamespace"
          @created="onExternalCreated"
        />
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="t('skill.managedTab')" name="managed">
          <el-table :data="pagedManagedRows" data-test="skill-list-managed" v-loading="loading">
            <el-table-column :label="t('skill.name')" min-width="240">
              <template #default="{ row }">
                <SkillIdentity :skill="row" :show-namespace-badge="!lockedNamespace" />
              </template>
            </el-table-column>
            <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
            <el-table-column :label="t('columns.downloadCount')" width="100">
              <template #default="{ row }">
                <span :data-test="`download-count-${row.skillName}`">{{ formatNumber(row.downloadCount ?? 0) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.status')" width="100">
              <template #default="{ row }">{{ t(statusText(row.status)) }}</template>
            </el-table-column>
            <el-table-column :label="t('columns.shareState')" width="140">
              <template #default="{ row }">
                <!-- ADR-0064:组织级共享只对组织技能存在;个人技能该格留空占位 -->
                <span v-if="row.personalNamespace" class="share-empty">-</span>
                <el-tag v-else :type="row.state.tagType" :data-test="`skill-state-${row.skillName}`">{{ t(row.state.text) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('columns.actions')" width="140">
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  :data-test="`configure-${row.skillName}`"
                  @click="openManage(row)"
                >
                  {{ t('actions.manage') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="t('skill.sharedTab')" name="shared">
          <el-table :data="pagedSharedRows" data-test="skill-list-shared" v-loading="loading">
            <el-table-column :label="t('skill.name')" min-width="240">
              <template #default="{ row }">
                <SkillIdentity :skill="row" :show-namespace-badge="!lockedNamespace" />
              </template>
            </el-table-column>
            <el-table-column prop="createdBy" :label="t('skill.createdBy')" width="160" />
            <el-table-column :label="t('columns.downloadCount')" width="100">
              <template #default="{ row }">
                <span :data-test="`download-count-${row.skillName}`">{{ formatNumber(row.downloadCount ?? 0) }}</span>
              </template>
            </el-table-column>
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
      <div class="skill-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="activeTab === 'managed' ? visibleManagedRows.length : visibleSharedRows.length"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :disabled="loading"
          data-test="skill-pagination"
        />
      </div>

      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import SkillIdentity from '../../components/SkillIdentity.vue';
import ExternalReferenceCreateDialog from '../../components/ExternalReferenceCreateDialog.vue';
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
import { buildManageEntryQuery } from '../../skills/manage-navigation';

const { t, formatNumber } = useLocaleState();

// 技能列表页（ADR-0035）：一处实现，两处入口——个人控制台的「技能」是跨命名
// 空间聚合，组织详情页的「技能」页签是同一列表锁定到该组织命名空间。服务端
// inventory 本就跨命名空间返回，锁定纯属展示层筛选，权限判定同源。
const props = defineProps<{ lockedNamespace?: string }>();

const route = useRoute();
const router = useRouter();

interface ManagedRow extends SkillInventoryItem {
  state: ReturnType<typeof deriveShareState>;
}

// 页签/页码与 URL query 双向同步：从技能管理页返回（或浏览器后退）时恢复原位置，
// 否则整表重挂载会把用户丢回第 1 页"我管理的"，看起来像原来那行技能不见了。
const activeTab = ref<'managed' | 'shared'>(route.query.tab === 'shared' ? 'shared' : 'managed');
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

const initialPage = Number.parseInt(String(route.query.page ?? '1'), 10);
const currentPage = ref(Number.isFinite(initialPage) && initialPage > 1 ? initialPage : 1);
const pageSize = ref(20);
const pagedManagedRows = computed(() => visibleManagedRows.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value));
const pagedSharedRows = computed(() => visibleSharedRows.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value));
watch([namespaceFilter, activeTab, pageSize], () => { currentPage.value = 1; });

// 翻页/切页签用 replace 写回 URL：不污染历史栈，同时让面包屑/后退能复原位置。
// 单独一个 watcher 观察组合状态，避免同一 flush 内多次 replace 互相覆盖。
function syncQuery(patch: Record<string, string | undefined>): void {
  const merged = new Map<string, string>();
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string' && value) merged.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) merged.set(key, value);
    else merged.delete(key);
  }
  // 锁定命名空间的组织视图由路由决定范围，URL 上不出现 namespace。
  if (props.lockedNamespace) merged.delete('namespace');
  const next = Object.fromEntries(merged);
  const currentQuery = new URLSearchParams(
    Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  ).toString();
  if (currentQuery === new URLSearchParams(next).toString()) return;
  void router.replace({ query: next });
}

watch(
  () => ({ tab: activeTab.value, page: currentPage.value, namespace: namespaceFilter.value }),
  (state) => {
    const patch: Record<string, string | undefined> = {
      tab: state.tab === 'shared' ? 'shared' : undefined,
      page: state.page > 1 ? String(state.page) : undefined
    };
    if (!props.lockedNamespace) patch.namespace = state.namespace || undefined;
    syncQuery(patch);
  }
);

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'me-skill-manage',
    params: { scope, skillName },
    query: buildManageEntryQuery(route, { tab: activeTab.value, page: currentPage.value })
  });
}

// 外部引用技能分流到只读外部管理面板（ADR-0074）。
const showCreateDialog = ref(false);

function openManage(row: SkillInventoryItem): void {
  if (row.external) {
    void router.push({
      name: 'me-external-manage',
      params: { scope: row.scope, skillName: row.skillName },
      query: buildManageEntryQuery(route, { tab: activeTab.value, page: currentPage.value })
    });
  } else {
    openPermissions(row.scope, row.skillName);
  }
}

async function onExternalCreated(fullName: string): Promise<void> {
  const withoutAt = fullName.replace(/^@/, '');
  const slash = withoutAt.indexOf('/');
  const scope = withoutAt.slice(0, slash);
  const shortName = withoutAt.slice(slash + 1);
  showCreateDialog.value = false;
  await router.push({
    name: 'me-external-manage',
    params: { scope, skillName: shortName },
    query: buildManageEntryQuery(route, { tab: activeTab.value, page: currentPage.value })
  });
  // 刷新清单以显示新引用。
  await loadInventory();
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

async function loadInventory(): Promise<void> {
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
}

onMounted(loadInventory);
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}

.share-empty {
  color: var(--el-text-color-secondary);
}
</style>

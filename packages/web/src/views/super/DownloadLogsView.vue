<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar download-log-toolbar">
        <el-input
          v-model="skill"
          data-test="download-log-skill-filter"
          :placeholder="t('downloadLog.skillPlaceholder')"
          clearable
          @keyup.enter="applyFilters"
        />
        <el-input
          v-model="username"
          data-test="download-log-username-filter"
          :placeholder="t('downloadLog.usernamePlaceholder')"
          clearable
          @keyup.enter="applyFilters"
        />
        <el-select v-model="result" data-test="download-log-result-filter" @change="applyFilters">
          <el-option value="all" :label="t('downloadLog.allResults')" />
          <el-option value="success" :label="t('downloadLog.success')" />
          <el-option value="failure" :label="t('downloadLog.failure')" />
        </el-select>
        <el-date-picker
          v-model="range"
          data-test="download-log-range-filter"
          type="datetimerange"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          :start-placeholder="t('downloadLog.rangePlaceholder')"
          :end-placeholder="t('downloadLog.rangePlaceholder')"
          :default-time="defaultTime"
          @change="applyFilters"
        />
        <el-button type="primary" data-test="download-log-search-submit" @click="applyFilters">
          {{ t('downloadLog.search') }}
        </el-button>
      </div>

      <!-- 明细含用户名与截断来源网段（ADR-0067），属可识别个人的行为画像，仅超管可见 -->
      <el-table :data="rows" data-test="download-logs-table" v-loading="loading">
        <el-table-column :label="t('downloadLog.downloadedAt')" width="170">
          <template #default="{ row }">{{ formatDate(row.downloadedAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.skill')" min-width="200">
          <template #default="{ row }">
            <code v-if="row.skillIdentity || row.skillId" class="log-identity">{{ row.skillIdentity ?? row.skillId }}</code>
            <span v-else class="log-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.version')" width="100">
          <template #default="{ row }">{{ row.version ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.requestedSpecifier')" width="160">
          <template #default="{ row }">{{ row.requestedSpecifier ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.username')" width="140">
          <template #default="{ row }">{{ row.username ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.result')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.result === 'success' ? 'success' : 'danger'" :data-test="`download-log-result-${row.id}`">
              {{ row.result === 'success' ? t('downloadLog.success') : t('downloadLog.failure') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.failureReason')" min-width="180">
          <template #default="{ row }">{{ row.failureReason ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.clientIp')" width="150">
          <template #default="{ row }">{{ row.clientIpTruncated ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.clientEnv')" width="180">
          <template #default="{ row }">
            <span v-if="row.osPlatform || row.osArch">{{ [row.osPlatform, row.osArch].filter(Boolean).join('/') }}</span>
            <span v-else class="log-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.eslVersion')" width="120">
          <template #default="{ row }">{{ row.eslVersion ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('downloadLog.nodeVersion')" width="120">
          <template #default="{ row }">{{ row.nodeVersion ?? '—' }}</template>
        </el-table-column>
        <template #empty>
          <span v-if="!loading && !errorMessage">{{ t('downloadLog.empty') }}</span>
        </template>
      </el-table>

      <div class="skill-pagination">
        <!-- 明细查询在服务端分页：total 来自响应，翻页与改页大小都重新发起查询 -->
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :disabled="loading"
          data-test="download-log-pagination"
        />
      </div>

      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { apiRequest } from '../../api/client';
import { formatRequestError, useLocaleState } from '../../i18n/locale';

// 下载日志明细（ADR-0067）：含用户名与截断 IP 段的个人行为画像，只有超级管理员
// 可查。与其它管理页不同，筛选与分页都在服务端完成——明细量随时间增长，客户端
// 分页会先把全量拉回本地，既慢又把不该一次下发的数据一次性下发。
interface DownloadLogRow {
  id: number;
  skillId: string | null;
  skillIdentity: string | null;
  version: string | null;
  requestedSpecifier: string | null;
  userId: string | null;
  username: string | null;
  clientIpTruncated: string | null;
  osPlatform: string | null;
  osArch: string | null;
  eslVersion: string | null;
  nodeVersion: string | null;
  downloadedAt: string;
  result: 'success' | 'failure';
  failureReason: string | null;
}

interface DownloadLogPage {
  items: DownloadLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

const { t, formatDate } = useLocaleState();

const skill = ref('');
const username = ref('');
const result = ref<'all' | 'success' | 'failure'>('all');
const range = ref<[string, string] | null>(null);

const rows = ref<DownloadLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const loading = ref(false);
const errorMessage = ref('');

// 只选日期时把时间补成当天的起止点，避免 00:00:00 造成的空区间歧义
const defaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 23, 59, 59)
];

function buildQuery(): string {
  const params = new URLSearchParams();
  if (skill.value.trim()) params.set('skill', skill.value.trim());
  if (username.value.trim()) params.set('username', username.value.trim());
  if (result.value !== 'all') params.set('result', result.value);
  if (range.value?.[0]) params.set('from', range.value[0]);
  if (range.value?.[1]) params.set('to', range.value[1]);
  params.set('page', String(page.value));
  params.set('pageSize', String(pageSize.value));
  return params.toString();
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiRequest<DownloadLogPage>(`/api/admin/download-logs?${buildQuery()}`);
    rows.value = response.items ?? [];
    total.value = response.total ?? 0;
  } catch (error) {
    errorMessage.value = formatRequestError(error);
    // 查询失败时清空上一页的行与总数：留着旧结果会让错误提示下方继续展示
    // 与当前筛选条件不符的数据。
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

// 筛选条件变化一律回到第 1 页：沿用旧页码会落在可能已经不存在的页上
function applyFilters(): void {
  if (page.value === 1) {
    void load();
  } else {
    page.value = 1;
  }
}

watch(page, () => { void load(); });
watch(pageSize, () => {
  // 改页大小同样从第 1 页重新查；页码本就为 1 时不会触发上面的 watch，直接查
  if (page.value === 1) {
    void load();
  } else {
    page.value = 1;
  }
});

onMounted(load);
</script>

<style scoped>
.download-log-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.download-log-toolbar :deep(.el-input) {
  max-width: 260px;
}

.download-log-toolbar :deep(.el-select) {
  width: 150px;
}

.log-identity {
  font-family: var(--font-family-mono);
  font-size: var(--fs-xs);
  color: var(--el-text-color-secondary);
}

.log-empty {
  color: var(--el-text-color-secondary);
}

.page-error {
  margin-top: 16px;
}
</style>

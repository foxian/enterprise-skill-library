<template>
  <div>
    <el-card class="data-card" shadow="never">
      <div class="console-toolbar">
        <el-radio-group v-model="status" data-test="registration-filter" @change="load">
          <el-radio-button value="pending">待审批</el-radio-button>
          <el-radio-button value="approved">已批准</el-radio-button>
          <el-radio-button value="rejected">已拒绝</el-radio-button>
        </el-radio-group>
      </div>
      <el-table :data="registrations" data-test="registrations-table" v-loading="loading">
        <el-table-column prop="username" label="用户名" />
        <el-table-column label="命名空间" width="180">
          <template #default="{ row }">@{{ row.username }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="200">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" :data-test="`registration-status-${row.id}`">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="status === 'pending'" label="操作" width="180">
          <template #default="{ row }">
            <el-button link type="success" :data-test="`approve-registration-${row.id}`" @click="approve(row)">
              批准
            </el-button>
            <el-button link type="danger" :data-test="`reject-registration-${row.id}`" @click="reject(row)">
              拒绝
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../api/client';

// 用户注册审批（ADR-0032 / #60）：approval 模式下账号先建后禁用，
// 批准 = 解禁登录，拒绝 = 删除账号并释放用户名。
interface RegistrationView {
  id: number;
  username: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const status = ref<'pending' | 'approved' | 'rejected'>('pending');
const registrations = ref<RegistrationView[]>([]);
const loading = ref(false);
const errorMessage = ref('');

function formatTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function statusText(value: RegistrationView['status']): string {
  return value === 'pending' ? '待审批' : value === 'approved' ? '已批准' : '已拒绝';
}

function statusTagType(value: RegistrationView['status']): 'warning' | 'success' | 'info' {
  return value === 'pending' ? 'warning' : value === 'approved' ? 'success' : 'info';
}

async function load(): Promise<void> {
  errorMessage.value = '';
  loading.value = true;
  try {
    registrations.value = await apiRequest<RegistrationView[]>(
      `/api/admin/registrations?status=${status.value}`
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function approve(row: RegistrationView): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/admin/registrations/${row.id}/approve`, { method: 'POST' });
    ElMessage.success(`已批准 ${row.username} 的注册`);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function reject(row: RegistrationView): Promise<void> {
  errorMessage.value = '';
  try {
    await apiRequest(`/api/admin/registrations/${row.id}/reject`, { method: 'POST' });
    ElMessage.success(`已拒绝 ${row.username} 的注册`);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(load);
</script>

<style scoped>
.console-toolbar {
  margin-bottom: 12px;
}

.page-error {
  margin-top: 16px;
}
</style>

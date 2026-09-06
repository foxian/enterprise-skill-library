<template>
  <div>
    <el-card class="data-card" shadow="never">
      <el-table :data="rows" data-test="member-skills-table" v-loading="loading">
        <el-table-column prop="name" label="技能名" />
        <el-table-column prop="createdBy" label="创建者" width="160" />
        <el-table-column label="共享状态" width="140">
          <template #default="{ row }">
            <el-tag :type="row.state.tagType" :data-test="`skill-state-${row.skillName}`">{{ row.state.text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :data-test="`configure-${row.skillName}`"
              @click="openPermissions(row.scope, row.skillName)"
            >
              配置权限
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { deriveShareState, loadSkillSummaries, type SkillSummary } from '../../skills/skill-list';

const router = useRouter();
const auth = useAuthStore();

type SkillRow = SkillSummary & { state: ReturnType<typeof deriveShareState> };

const rows = ref<SkillRow[]>([]);
const loading = ref(false);
const errorMessage = ref('');

function openPermissions(scope: string, skillName: string): void {
  void router.push({
    name: 'member-skill-permissions',
    params: { scope, skillName }
  });
}

onMounted(async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    // 成员视角只展示自己创建的技能
    const creator = auth.org ? `${auth.org}_${auth.username}` : auth.username;
    const summaries = await loadSkillSummaries((skill) => skill.createdBy === creator);
    rows.value = summaries.map((summary) => ({ ...summary, state: deriveShareState(summary.matrix) }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
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

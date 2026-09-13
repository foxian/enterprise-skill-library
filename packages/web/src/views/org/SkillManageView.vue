<template>
  <div>
    <SkillManagePanel
      :scope="scope"
      :skill-name="skillName"
      :team-options="teams"
      :member-options="memberOptions"
    />
    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" class="page-error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SkillManagePanel from '../../components/SkillManagePanel.vue';
import { apiRequest } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import type { MemberOption, TeamOption } from '../../skills/skill-list';

const route = useRoute();
const auth = useAuthStore();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));

const teams = ref<TeamOption[]>([]);
const memberOptions = ref<MemberOption[]>([]);
const errorMessage = ref('');

const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers']);

onMounted(async () => {
  // 组织管理员可为授权提供团队与成员下拉建议
  errorMessage.value = '';
  try {
    const [teamList, memberList] = await Promise.all([
      apiRequest<TeamOption[]>(`/api/orgs/${auth.org}/teams`),
      apiRequest<MemberOption[]>(`/api/orgs/${auth.org}/members`)
    ]);
    // 团队授权下拉仅列自定义团队(ADR-0032):常设团队是批量授权载体
    teams.value = teamList.filter((team) => !DEFAULT_TEAM_NAMES.has(team.name));
    memberOptions.value = memberList;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<style scoped>
.page-error {
  margin-top: 16px;
}
</style>

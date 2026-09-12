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
import type { MemberOption, TeamOption } from '../../skills/skill-list';

const route = useRoute();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));

const teams = ref<TeamOption[]>([]);
const memberOptions = ref<MemberOption[]>([]);
const errorMessage = ref('');

const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers', 'system-admins']);

onMounted(async () => {
  // 组织管理员可为授权提供团队与成员下拉建议
  errorMessage.value = '';
  try {
    const [teamList, memberList] = await Promise.all([
      apiRequest<TeamOption[]>('/api/orgs/teams'),
      apiRequest<MemberOption[]>('/api/orgs/members')
    ]);
    // 团队授权下拉仅列自定义团队(ADR-0026):默认团队由组织共享级别承载
    teams.value = teamList.filter((team) => !DEFAULT_TEAM_NAMES.has(team.name));
    // 成员授权下拉排除 admin 账号与系统管理团队成员:两者结构性持有全部
    // 技能的 Manage,逐技能授予无意义(ADR-0026)
    const systemAdmins = teamList.find((team) => team.name === 'system-admins');
    const systemAdminsMembers = systemAdmins
      ? await apiRequest<Array<{ username: string }>>(`/api/orgs/teams/${systemAdmins.id}/members`)
      : [];
    const excluded = new Set(systemAdminsMembers.map((member) => member.username));
    excluded.add(`${scope.value}_admin`);
    memberOptions.value = memberList.filter((member) => !excluded.has(member.username));
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

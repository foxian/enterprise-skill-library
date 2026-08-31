<template>
  <div>
    <SkillPermissionsPanel
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
import SkillPermissionsPanel from '../../components/SkillPermissionsPanel.vue';
import { apiRequest } from '../../api/client';
import type { MemberOption, TeamOption } from '../../skills/skill-list';

const route = useRoute();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));

const teams = ref<TeamOption[]>([]);
const memberOptions = ref<MemberOption[]>([]);
const errorMessage = ref('');

onMounted(async () => {
  // 组织管理员可为授权提供团队与成员下拉建议
  errorMessage.value = '';
  try {
    const [teamList, memberList] = await Promise.all([
      apiRequest<TeamOption[]>('/api/orgs/teams'),
      apiRequest<MemberOption[]>('/api/orgs/members')
    ]);
    teams.value = teamList;
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

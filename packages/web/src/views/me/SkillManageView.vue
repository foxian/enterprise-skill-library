<template>
  <div>
    <!-- 授权目标下拉只在"该技能的命名空间归我治理"时才有数据源；个人技能或
         组织成员视角没有组织级团队/成员列表，退回面板内手工输入 -->
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
// 深层引入纯函数模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import { STANDING_TEAM_NAMES } from '@esl/core/dist/org/standing-teams.js';
import type { MemberOption, TeamOption } from '../../skills/skill-list';

const route = useRoute();
const auth = useAuthStore();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));

const teams = ref<TeamOption[]>([]);
const memberOptions = ref<MemberOption[]>([]);
const errorMessage = ref('');

const STANDING_TEAMS = new Set(STANDING_TEAM_NAMES);

onMounted(async () => {
  errorMessage.value = '';
  // 个人命名空间不属于任何组织，没有组织级授权目标；组织命名空间要求查看者
  // 是管理成员或所有者成员（ADR-0038 的逐组织运营权）。
  if (!auth.isOrgOperator(scope.value)) {
    return;
  }
  try {
    const [teamList, memberList] = await Promise.all([
      apiRequest<TeamOption[]>(`/api/orgs/${scope.value}/teams`),
      apiRequest<MemberOption[]>(`/api/orgs/${scope.value}/members`)
    ]);
    // 团队授权下拉仅列自定义团队（ADR-0032）：常设团队是批量授权载体
    teams.value = teamList.filter((team) => !STANDING_TEAMS.has(team.name));
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

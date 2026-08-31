<template>
  <!-- 成员视角没有组织级团队/成员列表权限，授权目标由面板内手工输入 -->
  <SkillPermissionsPanel :scope="scope" :skill-name="skillName" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SkillPermissionsPanel from '../../components/SkillPermissionsPanel.vue';

const route = useRoute();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));
</script>

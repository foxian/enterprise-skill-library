<template>
  <SkillManagePanel :scope="scope" :skill-name="skillName" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SkillManagePanel from '../../components/SkillManagePanel.vue';

const route = useRoute();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));
</script>

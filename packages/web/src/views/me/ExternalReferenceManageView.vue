<template>
  <ExternalReferenceManagePanel :scope="scope" :skill-name="skillName" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ExternalReferenceManagePanel from '../../components/ExternalReferenceManagePanel.vue';

const route = useRoute();
const scope = computed(() => String(route.params.scope ?? ''));
const skillName = computed(() => String(route.params.skillName ?? ''));
</script>

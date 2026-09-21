<template>
  <ConsoleShell :brand="t('common.workspace')" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { Odometer, OfficeBuilding, Tickets, User, Collection, Setting } from '@element-plus/icons-vue';
import { useLocaleState } from '../../i18n/locale';

const { t } = useLocaleState();
const menuItems = computed<ConsoleMenuItem[]>(() => [
  { index: '/admin/super/dashboard', label: t('nav.platformOverview'), icon: Odometer },
  { index: '/admin/super/orgs', label: t('nav.orgManagement'), icon: OfficeBuilding },
  { index: '/admin/super/applications', label: t('nav.orgApplications'), icon: Tickets },
  { index: '/admin/super/registrations', label: t('nav.userRegistrations'), icon: User },
  { index: '/admin/super/skills', label: t('nav.skillOverview'), icon: Collection },
  { index: '/admin/super/settings', label: t('nav.platformSettings'), icon: Setting }
]);
</script>

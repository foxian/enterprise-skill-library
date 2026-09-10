<template>
  <ConsoleShell brand="ESL工作台" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { Odometer, OfficeBuilding, Tickets, Collection, Setting } from '@element-plus/icons-vue';

const menuItems: ConsoleMenuItem[] = [
  { index: '/admin/super/dashboard', label: '平台概览', icon: Odometer },
  { index: '/admin/super/orgs', label: '组织管理', icon: OfficeBuilding },
  { index: '/admin/super/applications', label: '注册审批', icon: Tickets },
  { index: '/admin/super/skills', label: '技能总览', icon: Collection },
  { index: '/admin/super/settings', label: '平台设置', icon: Setting }
];
</script>

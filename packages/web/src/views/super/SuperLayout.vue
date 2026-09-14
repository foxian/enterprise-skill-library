<template>
  <ConsoleShell brand="ESL工作台" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { Odometer, OfficeBuilding, Tickets, User, Collection, Setting } from '@element-plus/icons-vue';

const menuItems: ConsoleMenuItem[] = [
  { index: '/admin/super/dashboard', label: '平台概览', icon: Odometer },
  { index: '/admin/super/orgs', label: '组织管理', icon: OfficeBuilding },
  { index: '/admin/super/applications', label: '组织申请审批', icon: Tickets },
  { index: '/admin/super/registrations', label: '用户注册审批', icon: User },
  { index: '/admin/super/skills', label: '技能总览', icon: Collection },
  { index: '/admin/super/settings', label: '平台设置', icon: Setting }
];
</script>

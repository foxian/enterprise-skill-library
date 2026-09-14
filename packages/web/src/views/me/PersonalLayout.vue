<template>
  <ConsoleShell brand="ESL工作台" :menu-items="menuItems">
    <router-view />
  </ConsoleShell>
</template>

<script setup lang="ts">
import ConsoleShell from '../../components/layout/ConsoleShell.vue';
import type { ConsoleMenuItem } from '../../components/layout/ConsoleShell.vue';
import { DataBoard, Files, OfficeBuilding, Promotion } from '@element-plus/icons-vue';

// 个人控制台的菜单（ADR-0035）。组织治理不是独立视角——它挂在「我的组织」下，
// 且入口只对组织管理团队成员渲染。
const menuItems: ConsoleMenuItem[] = [
  { index: '/admin/me/overview', label: '概览', icon: DataBoard },
  { index: '/admin/me/orgs', label: '我的组织', icon: OfficeBuilding },
  { index: '/admin/me/skills', label: '技能', icon: Files },
  { index: '/admin/me/invitations', label: '邀请', icon: Promotion }
];
</script>

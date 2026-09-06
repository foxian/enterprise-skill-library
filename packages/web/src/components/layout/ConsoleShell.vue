<template>
  <el-container class="console-shell" direction="horizontal">
    <el-aside width="var(--sidebar-width)">
      <div class="console-brand">
        <span class="console-brand-mark" aria-hidden="true"></span>
        <span class="console-brand-text">{{ brand }}</span>
      </div>
      <el-menu router :default-active="route.path" class="console-menu">
        <el-menu-item v-for="item in menuItems" :key="item.index" :index="item.index">
          <el-icon v-if="item.icon" class="console-menu-icon">
            <component :is="item.icon" />
          </el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
      <div class="console-aside-user">
        <el-dropdown trigger="click" placement="top-start" :teleported="false" @command="onCommand">
          <button class="console-user" type="button" data-test="user-dropdown">
            <el-avatar :size="30" class="console-user-avatar">{{ avatarText }}</el-avatar>
            <span class="console-user-meta">
              <span class="console-user-name">{{ auth.username }}</span>
              <span class="console-user-role">{{ roleLabel }}</span>
            </span>
            <span class="console-user-caret" aria-hidden="true">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="console-user-meta-panel">
                <div class="console-user-meta-name">{{ auth.username }}</div>
                <div class="console-user-meta-sub">
                  <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
                  <span v-if="auth.org" class="console-user-meta-org">{{ auth.org }}</span>
                </div>
              </div>
              <el-dropdown-item command="change-password" data-test="change-password">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided data-test="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-aside>
    <el-container direction="vertical">
      <el-header class="console-header" height="var(--header-height)">
        <div class="console-header-title">
          <h1 class="console-header-name">{{ currentTitle }}</h1>
          <span v-if="currentDescription" class="console-header-desc">{{ currentDescription }}</span>
        </div>
      </el-header>
      <el-main class="console-main">
        <div class="console-content">
          <slot></slot>
        </div>
      </el-main>
    </el-container>
    <ChangePasswordDialog ref="dialog" />
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChangePasswordDialog from '../ChangePasswordDialog.vue';
import { useAuthStore, type Role } from '../../stores/auth';

export interface ConsoleMenuItem {
  index: string;
  label: string;
  icon?: Component;
}

defineProps<{
  brand: string;
  menuItems: ConsoleMenuItem[];
}>();

const ROLE_LABELS: Record<Role, string> = {
  super: '超级管理员',
  'org-admin': '组织管理员',
  member: '成员'
};

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const dialog = ref<InstanceType<typeof ChangePasswordDialog> | null>(null);

const avatarText = computed<string>(() => (auth.username ?? '?').charAt(0).toUpperCase());

const roleLabel = computed<string>(() => (auth.role ? ROLE_LABELS[auth.role] : ''));

const currentTitle = computed<string>(() => {
  const meta = route.meta as { title?: string };
  return meta.title ?? '';
});

const currentDescription = computed<string>(() => {
  const meta = route.meta as { description?: string };
  return meta.description ?? '';
});

async function onCommand(command: string): Promise<void> {
  if (command === 'change-password') {
    dialog.value?.open();
  } else if (command === 'logout') {
    auth.logout();
    await router.push({ name: 'login' });
  }
}
</script>

<template>
  <el-container class="console-shell">
    <el-aside width="200px">
      <div class="console-brand">ESL 平台治理</div>
      <el-menu router :default-active="$route.path">
        <el-menu-item index="/admin/super/dashboard">平台概览</el-menu-item>
        <el-menu-item index="/admin/super/orgs">组织管理</el-menu-item>
        <el-menu-item index="/admin/super/applications">注册审批</el-menu-item>
        <el-menu-item index="/admin/super/settings">平台设置</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="console-header">
        <span>超级管理员：{{ auth.username }}</span>
        <el-button link type="primary" data-test="logout" @click="logout">退出登录</el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  auth.logout();
  await router.push({ name: 'login' });
}
</script>

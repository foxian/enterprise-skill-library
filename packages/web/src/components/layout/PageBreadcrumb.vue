<template>
  <el-breadcrumb class="page-breadcrumb" separator="/">
    <el-breadcrumb-item v-for="(item, index) in items" :key="index" :to="item.to">
      <span :data-test="item.test ?? `crumb-${index}`">{{ item.label }}</span>
    </el-breadcrumb-item>
  </el-breadcrumb>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

/**
 * 控制台二级页的统一面包屑（ADR-0035 视图内的语义父级）。
 * `to` 省略表示当前页：不可点。`label` 由调用方传入已翻译文案，
 * 资源实体名（组织名、@scope/name）直接插值。
 */
export interface PageBreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
  test?: string;
}

defineProps<{ items: PageBreadcrumbItem[] }>();
</script>

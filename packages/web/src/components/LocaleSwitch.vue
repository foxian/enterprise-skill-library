<template>
  <el-radio-group
    :model-value="current"
    size="small"
    data-test="locale-switch"
    @update:model-value="setLocale($event as Locale)"
  >
    <el-radio-button value="zh-CN" data-test="locale-zh-CN">中文</el-radio-button>
    <el-radio-button value="en-US" data-test="locale-en-US">English</el-radio-button>
  </el-radio-group>
</template>

<script setup lang="ts">
import type { Locale } from '@esl/i18n';
import { useLocaleState } from '../i18n/locale';

const { current, setLocale } = useLocaleState();
</script>

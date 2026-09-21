// element-plus 2.x 的 dist/locale/*.mjs 子路径已不再附带类型声明（*.d.mts
// 自浮动升级到 2.14.5 后消失），vue-tsc 对 App.vue 的两处 locale 导入报
// TS7016（strict 下 noImplicitAny）。这里显式补声明。
//
// 类型取宽（Record<string, unknown>）：el-config-provider 的 locale prop
// 的 Language 类型经由 skipLibCheck 的声明文件导入，实际按 any 处理，宽类型
// 不会削弱既有检查；也不引用 element-plus/dist/locale 的类型入口——该入口
// 已不存在，import type 会在非声明文件上下文报 TS2307。
declare module 'element-plus/dist/locale/zh-cn.mjs' {
  const locale: Record<string, unknown>;
  export default locale;
}

declare module 'element-plus/dist/locale/en.mjs' {
  const locale: Record<string, unknown>;
  export default locale;
}

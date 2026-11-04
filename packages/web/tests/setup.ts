// jsdom 没有实现滚动 API，而 router 的 scrollBehavior 会在每次导航后调用它。
// 这里提供空实现，避免测试输出被 "Not implemented: window.scrollTo" 噪音淹没。
window.scrollTo = () => {};

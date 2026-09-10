import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import RegisterView from '../views/RegisterView.vue';
import SuperLayout from '../views/super/SuperLayout.vue';
import SuperDashboard from '../views/super/DashboardView.vue';
import SuperOrgs from '../views/super/OrgsView.vue';
import SuperOrgDetail from '../views/super/OrgDetailView.vue';
import SuperApplications from '../views/super/ApplicationsView.vue';
import SuperSettings from '../views/super/SettingsView.vue';
import SuperSkills from '../views/super/SkillsView.vue';
import SuperSkillPermissions from '../views/super/SkillPermissionsView.vue';
import OrgLayout from '../views/org/OrgLayout.vue';
import OrgMembers from '../views/org/MembersView.vue';
import OrgTeams from '../views/org/TeamsView.vue';
import OrgSkills from '../views/org/SkillsView.vue';
import OrgSkillPermissions from '../views/org/SkillPermissionsView.vue';
import MemberLayout from '../views/member/MemberLayout.vue';
import MemberSkills from '../views/member/SkillsView.vue';
import MemberSkillPermissions from '../views/member/SkillPermissionsView.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/admin/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/admin/register', name: 'register', component: RegisterView, meta: { public: true } },
    {
      path: '/admin/super',
      component: SuperLayout,
      meta: { role: 'super' },
      children: [
        { path: '', redirect: { name: 'super-dashboard' } },
        { path: 'dashboard', name: 'super-dashboard', component: SuperDashboard, meta: { title: '平台概览', description: '组织、审批与技能资源的实时汇总' } },
        { path: 'orgs', name: 'super-orgs', component: SuperOrgs, meta: { title: '组织管理', description: '查看平台内全部组织的生命周期与资源概况' } },
        { path: 'orgs/:orgName', name: 'super-org-detail', component: SuperOrgDetail, meta: { title: '组织详情' } },
        { path: 'applications', name: 'super-applications', component: SuperApplications, meta: { title: '注册审批', description: '处理组织注册申请，批准后将自动开通组织资源' } },
        { path: 'skills', name: 'super-skills', component: SuperSkills, meta: { title: '技能总览', description: '跨组织查看全部技能（含未发布）并代管权限' } },
        { path: 'skills/:scope/:skillName/permissions', name: 'super-skill-permissions', component: SuperSkillPermissions, meta: { title: '技能权限详情' } },
        { path: 'settings', name: 'super-settings', component: SuperSettings, meta: { title: '平台设置', description: '配置组织注册的审批模式与平台级策略' } }
      ]
    },
    {
      path: '/admin/org',
      component: OrgLayout,
      meta: { role: 'org-admin' },
      children: [
        { path: '', redirect: { name: 'org-members' } },
        { path: 'members', name: 'org-members', component: OrgMembers, meta: { title: '成员管理', description: '管理组织内成员账号，支持添加、重置密码与禁用' } },
        { path: 'teams', name: 'org-teams', component: OrgTeams, meta: { title: '团队管理', description: '按团队分配技能读写权限，系统团队不可删除' } },
        { path: 'skills', name: 'org-skills', component: OrgSkills, meta: { title: '技能权限', description: '管理组织内技能的共享范围与访问权限' } },
        { path: 'skills/:scope/:skillName/permissions', name: 'org-skill-permissions', component: OrgSkillPermissions, meta: { title: '技能权限详情' } }
      ]
    },
    {
      path: '/admin/member',
      component: MemberLayout,
      meta: { role: 'member' },
      children: [
        { path: '', redirect: { name: 'member-skills' } },
        { path: 'skills', name: 'member-skills', component: MemberSkills, meta: { title: '我管理的技能', description: '查看你管理的技能与共享给你的技能（含未发布）' } },
        { path: 'skills/:scope/:skillName/permissions', name: 'member-skill-permissions', component: MemberSkillPermissions, meta: { title: '技能权限详情' } }
      ]
    },
    { path: '/admin', redirect: '/admin/login' },
    { path: '/:pathMatch(.*)*', redirect: '/admin/login' }
  ]
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    return true;
  }
  if (!auth.isLoggedIn) {
    return { name: 'login' };
  }
  // 角色不匹配的路径不允许访问，退回登录页重新选择身份
  if (to.meta.role && to.meta.role !== auth.role) {
    return { name: 'login' };
  }
  return true;
});

export default router;

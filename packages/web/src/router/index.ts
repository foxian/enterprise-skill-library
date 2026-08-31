import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import RegisterView from '../views/RegisterView.vue';
import SuperLayout from '../views/super/SuperLayout.vue';
import SuperDashboard from '../views/super/DashboardView.vue';
import SuperOrgs from '../views/super/OrgsView.vue';
import SuperOrgDetail from '../views/super/OrgDetailView.vue';
import SuperApplications from '../views/super/ApplicationsView.vue';
import SuperSettings from '../views/super/SettingsView.vue';
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
        { path: 'dashboard', name: 'super-dashboard', component: SuperDashboard },
        { path: 'orgs', name: 'super-orgs', component: SuperOrgs },
        { path: 'orgs/:orgName', name: 'super-org-detail', component: SuperOrgDetail },
        { path: 'applications', name: 'super-applications', component: SuperApplications },
        { path: 'settings', name: 'super-settings', component: SuperSettings }
      ]
    },
    {
      path: '/admin/org',
      component: OrgLayout,
      meta: { role: 'org-admin' },
      children: [
        { path: '', redirect: { name: 'org-members' } },
        { path: 'members', name: 'org-members', component: OrgMembers },
        { path: 'teams', name: 'org-teams', component: OrgTeams },
        { path: 'skills', name: 'org-skills', component: OrgSkills },
        { path: 'skills/:scope/:skillName/permissions', name: 'org-skill-permissions', component: OrgSkillPermissions }
      ]
    },
    {
      path: '/admin/member',
      component: MemberLayout,
      meta: { role: 'member' },
      children: [
        { path: '', redirect: { name: 'member-skills' } },
        { path: 'skills', name: 'member-skills', component: MemberSkills },
        { path: 'skills/:scope/:skillName/permissions', name: 'member-skill-permissions', component: MemberSkillPermissions }
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

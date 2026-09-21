import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import UserRegisterView from '../views/UserRegisterView.vue';
import SuperLayout from '../views/super/SuperLayout.vue';
import SuperDashboard from '../views/super/DashboardView.vue';
import SuperOrgs from '../views/super/OrgsView.vue';
import SuperOrgDetail from '../views/super/OrgDetailView.vue';
import SuperApplications from '../views/super/ApplicationsView.vue';
import SuperRegistrations from '../views/super/RegistrationsView.vue';
import SuperUsers from '../views/super/UsersView.vue';
import SuperSettings from '../views/super/SettingsView.vue';
import SuperSkills from '../views/super/SkillsView.vue';
import SuperSkillManage from '../views/super/SkillManageView.vue';
import PersonalLayout from '../views/me/PersonalLayout.vue';
import OverviewView from '../views/me/OverviewView.vue';
import MeOrgsView from '../views/me/OrgsView.vue';
import OrgDetailLayout from '../views/me/OrgDetailLayout.vue';
import OrgMembersView from '../views/me/OrgMembersView.vue';
import OrgTeamsView from '../views/me/OrgTeamsView.vue';
import MeSkillsView from '../views/me/SkillsView.vue';
import MeSkillManageView from '../views/me/SkillManageView.vue';
import InvitationsView from '../views/me/InvitationsView.vue';
import { useAuthStore } from '../stores/auth';

/**
 * 路由守卫用的两个正交判定（ADR-0033 / ADR-0038）：`view` 是平台角色轴
 * （超管控制台 / 个人控制台，恰好两个），`requiresOrgOperator` 是资源级运营权
 * （该路由参数指名的组织，查看者是否是其管理成员或所有者成员）。不再用一个全局角色值
 * 代理资源级权限。
 */
export interface ConsoleRouteMeta {
  view?: 'platform' | 'personal';
  requiresOrgOperator?: boolean;
  public?: boolean;
  title?: string;
  description?: string;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/admin/login', name: 'login', component: LoginView, meta: { public: true } },
    // 公开路由只有账号注册。组织注册申请没有公开入口：它是已登录 Skill User
    // 在个人控制台内的动作（ADR-0032/0035），匿名提交连 token 都拿不出来。
    { path: '/admin/register-user', name: 'register-user', component: UserRegisterView, meta: { public: true } },
    {
      path: '/admin/super',
      component: SuperLayout,
      meta: { view: 'platform' },
      children: [
        { path: '', redirect: { name: 'super-dashboard' } },
        { path: 'dashboard', name: 'super-dashboard', component: SuperDashboard, meta: { title: 'routes.platformOverview', description: 'routes.platformOverviewDescription' } },
        { path: 'orgs', name: 'super-orgs', component: SuperOrgs, meta: { title: 'routes.orgManagement', description: 'routes.orgManagementDescription' } },
        { path: 'orgs/:orgName', name: 'super-org-detail', component: SuperOrgDetail, meta: { title: 'routes.orgDetail' } },
        { path: 'applications', name: 'super-applications', component: SuperApplications, meta: { title: 'routes.orgApplications', description: 'routes.orgApplicationsDescription' } },
        { path: 'registrations', name: 'super-registrations', component: SuperRegistrations, meta: { title: 'routes.userRegistrations', description: 'routes.userRegistrationsDescription' } },
        { path: 'users', name: 'super-users', component: SuperUsers, meta: { title: 'routes.userManagement', description: 'routes.userManagementDescription' } },
        { path: 'skills', name: 'super-skills', component: SuperSkills, meta: { title: 'routes.skillOverview', description: 'routes.skillOverviewDescription' } },
        { path: 'skills/:scope/:skillName/manage', name: 'super-skill-manage', component: SuperSkillManage, meta: { title: 'routes.skillManagement' } },
        { path: 'settings', name: 'super-settings', component: SuperSettings, meta: { title: 'routes.platformSettings', description: 'routes.platformSettingsDescription' } }
      ]
    },
    {
      // 个人控制台（ADR-0035）：概览 / 我的组织 / 技能 / 邀请。组织治理挂在
      // 「我的组织」下，不是独立视角。
      path: '/admin/me',
      component: PersonalLayout,
      meta: { view: 'personal' },
      children: [
        { path: '', redirect: { name: 'me-overview' } },
        { path: 'overview', name: 'me-overview', component: OverviewView, meta: { title: 'routes.overview', description: 'routes.overviewDescription' } },
        { path: 'orgs', name: 'me-orgs', component: MeOrgsView, meta: { title: 'routes.myOrganizations', description: 'routes.myOrganizationsDescription' } },
        {
          path: 'orgs/:org',
          component: OrgDetailLayout,
          meta: { requiresOrgOperator: true },
          children: [
            { path: '', redirect: { name: 'me-org-members' } },
            { path: 'members', name: 'me-org-members', component: OrgMembersView, meta: { title: 'routes.orgMembers', description: 'routes.orgMembersDescription' } },
            { path: 'teams', name: 'me-org-teams', component: OrgTeamsView, meta: { title: 'routes.orgTeams', description: 'routes.orgTeamsDescription' } },
            {
              path: 'skills',
              name: 'me-org-skills',
              component: MeSkillsView,
              // 与个人控制台的「技能」同一个页面，锁定到本组织命名空间（ADR-0035）
              props: (route) => ({ lockedNamespace: String(route.params.org ?? '') }),
              meta: { title: 'routes.skillManagement', description: 'routes.skillManagementDescription' }
            }
          ]
        },
        { path: 'skills', name: 'me-skills', component: MeSkillsView, meta: { title: 'routes.skills', description: 'routes.skillsDescription' } },
        { path: 'skills/:scope/:skillName/manage', name: 'me-skill-manage', component: MeSkillManageView, meta: { title: 'routes.skillManagement' } },
        { path: 'invitations', name: 'me-invitations', component: InvitationsView, meta: { title: 'routes.invitations', description: 'routes.invitationsDescription' } }
      ]
    },
    { path: '/admin', redirect: '/admin/login' },
    { path: '/:pathMatch(.*)*', redirect: '/admin/login' }
  ]
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const meta = to.meta as ConsoleRouteMeta;
  if (meta.public) {
    return true;
  }
  if (!auth.isLoggedIn) {
    return { name: 'login' };
  }
  // 两个控制台互不越界：超管不进个人控制台，普通用户不进超管控制台
  if (meta.view === 'platform' && !auth.isPlatformAdmin) {
    return { name: 'login' };
  }
  if (meta.view === 'personal' && auth.isPlatformAdmin) {
    return { name: 'login' };
  }
  // 资源级判定：运营入口对管理成员与所有者成员开放，其余人回只读的组织列表。
  if (meta.requiresOrgOperator && !auth.isOrgOperator(String(to.params.org ?? ''))) {
    return { name: 'me-orgs' };
  }
  return true;
});

export default router;

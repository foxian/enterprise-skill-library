import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import RegisterView from '../views/RegisterView.vue';
import UserRegisterView from '../views/UserRegisterView.vue';
import SuperLayout from '../views/super/SuperLayout.vue';
import SuperDashboard from '../views/super/DashboardView.vue';
import SuperOrgs from '../views/super/OrgsView.vue';
import SuperOrgDetail from '../views/super/OrgDetailView.vue';
import SuperApplications from '../views/super/ApplicationsView.vue';
import SuperRegistrations from '../views/super/RegistrationsView.vue';
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
 * 路由守卫用的两个正交判定（ADR-0033）：`view` 是平台角色轴（超管控制台 /
 * 个人控制台，恰好两个），`requiresOrgManager` 是资源级治理权（该路由参数
 * 指名的组织，查看者是否是其组织管理团队成员）。不再用一个全局角色值代理
 * 资源级权限。
 */
export interface ConsoleRouteMeta {
  view?: 'platform' | 'personal';
  requiresOrgManager?: boolean;
  public?: boolean;
  title?: string;
  description?: string;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/admin/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/admin/register', name: 'register', component: RegisterView, meta: { public: true } },
    { path: '/admin/register-user', name: 'register-user', component: UserRegisterView, meta: { public: true } },
    {
      path: '/admin/super',
      component: SuperLayout,
      meta: { view: 'platform' },
      children: [
        { path: '', redirect: { name: 'super-dashboard' } },
        { path: 'dashboard', name: 'super-dashboard', component: SuperDashboard, meta: { title: '平台概览', description: '组织、审批与技能资源的实时汇总' } },
        { path: 'orgs', name: 'super-orgs', component: SuperOrgs, meta: { title: '组织管理', description: '查看平台内全部组织的生命周期与资源概况' } },
        { path: 'orgs/:orgName', name: 'super-org-detail', component: SuperOrgDetail, meta: { title: '组织详情' } },
        { path: 'applications', name: 'super-applications', component: SuperApplications, meta: { title: '组织申请审批', description: '处理组织注册申请，批准即同步开通组织资源' } },
        { path: 'registrations', name: 'super-registrations', component: SuperRegistrations, meta: { title: '用户注册审批', description: '审批待激活的平台账号（approval 注册模式）' } },
        { path: 'skills', name: 'super-skills', component: SuperSkills, meta: { title: '技能总览', description: '跨组织查看全部技能（含未发布）并代管权限' } },
        { path: 'skills/:scope/:skillName/manage', name: 'super-skill-manage', component: SuperSkillManage, meta: { title: '技能管理' } },
        { path: 'settings', name: 'super-settings', component: SuperSettings, meta: { title: '平台设置', description: '配置组织注册的审批模式与平台级策略' } }
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
        { path: 'overview', name: 'me-overview', component: OverviewView, meta: { title: '概览', description: '待办、我的组织与我管理的技能' } },
        { path: 'orgs', name: 'me-orgs', component: MeOrgsView, meta: { title: '我的组织', description: '创建组织、查看我在每个组织中的身份' } },
        {
          path: 'orgs/:org',
          component: OrgDetailLayout,
          meta: { requiresOrgManager: true },
          children: [
            { path: '', redirect: { name: 'me-org-members' } },
            { path: 'members', name: 'me-org-members', component: OrgMembersView, meta: { title: '成员管理', description: '管理本组织成员，移出即自动离开三个常设团队' } },
            { path: 'teams', name: 'me-org-teams', component: OrgTeamsView, meta: { title: '团队管理', description: '自定义团队按权限级别批量授权；常设团队由平台维护' } },
            {
              path: 'skills',
              name: 'me-org-skills',
              component: MeSkillsView,
              // 与个人控制台的「技能」同一个页面，锁定到本组织命名空间（ADR-0035）
              props: (route) => ({ lockedNamespace: String(route.params.org ?? '') }),
              meta: { title: '技能管理', description: '本组织命名空间下的技能与它们的共享范围' }
            }
          ]
        },
        { path: 'skills', name: 'me-skills', component: MeSkillsView, meta: { title: '技能', description: '跨命名空间聚合：个人与所有所在组织的技能' } },
        { path: 'skills/:scope/:skillName/manage', name: 'me-skill-manage', component: MeSkillManageView, meta: { title: '技能管理' } },
        { path: 'invitations', name: 'me-invitations', component: InvitationsView, meta: { title: '邀请', description: '待你回应的组织邀请' } }
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
  // 资源级判定：治理入口只对组织管理团队成员开放，其余人回只读的组织列表
  if (meta.requiresOrgManager && !auth.isOrgManager(String(to.params.org ?? ''))) {
    return { name: 'me-orgs' };
  }
  return true;
});

export default router;

import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, orgApi } from '../lib/api';
import { useOrg, useSession } from '../lib/session';
import { Avatar, Empty, usePoll } from './ui';
import { Icon } from './Icon';

export function Layout() {
  const { orgId: raw } = useParams();
  const orgId = Number(raw);
  const { user, orgs, signOut } = useSession();
  const { org, isManager } = useOrg(orgId);
  const nav = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadUnread = useCallback(() => {
    if (!org) return;
    api.get<{ unread: number }>(orgApi(orgId)('/notifications/unread-count')).then((r) => setUnread(r.unread)).catch(() => {});
  }, [orgId, org]);
  useEffect(loadUnread, [loadUnread, loc.pathname]);
  usePoll(loadUnread, 15000);
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  useEffect(() => {
    const onRead = () => loadUnread();
    window.addEventListener('tb:notifications-changed', onRead);
    return () => window.removeEventListener('tb:notifications-changed', onRead);
  }, [loadUnread]);

  if (!org) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <Empty icon="lock" title="You are not part of this organisation">
            <p>Either it does not exist, or nobody has added you yet. Ask an owner to invite you.</p>
            {orgs[0] && <button className="btn btn-primary" onClick={() => nav(`/o/${orgs[0].id}/my-work`)}>Back to {orgs[0].name}</button>}
          </Empty>
        </div>
      </div>
    );
  }

  const link = (to: string, icon: string, label: string, badge?: number) => (
    <NavLink to={`/o/${orgId}/${to}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <Icon name={icon} />
      <span>{label}</span>
      {!!badge && <span className="badge" aria-label={`${badge} unread`}>{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  );

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Open menu" aria-expanded={menuOpen}><Icon name="menu" /></button>
        <span className="brand-name">TeamBoard</span>
        <NavLink to={`/o/${orgId}/notifications`} className="icon-btn" aria-label="Notifications">
          <Icon name="bell" />{!!unread && <span className="dot-badge" />}
        </NavLink>
      </header>

      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden><span /><span /><span /></span>
          <span className="brand-name">TeamBoard</span>
        </div>

        <label className="org-switch">
          <span className="sr-only">Organisation</span>
          <select value={orgId} onChange={(e) => nav(`/o/${e.target.value}/my-work`)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="org-role">You are {org.role === 'owner' ? 'an owner' : `a ${org.role}`}</span>
        </label>

        <nav aria-label="Main">
          {link('my-work', 'home', 'My work')}
          {link('projects', 'folder', 'Projects')}
          {link('notifications', 'bell', 'Notifications', unread)}
          {link('people', 'users', 'People')}
          {isManager && link('reports', 'chart', 'Reports')}
        </nav>

        <div className="sidebar-foot">
          <Avatar name={user?.name} size={32} />
          <div className="who">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="icon-btn" onClick={() => signOut().then(() => nav('/'))} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="scrim-mobile" onClick={() => setMenuOpen(false)} />

      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}

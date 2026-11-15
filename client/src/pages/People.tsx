import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api, orgApi } from '../lib/api';
import { useOrg, useSession } from '../lib/session';
import type { Member, Role } from '../lib/types';
import { Avatar, Field, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including inviting people and changing roles',
  manager: 'Sees every project, creates projects, sees reports',
  employee: 'Works on the projects they are added to',
};

interface Team { id: number; name: string; members: { id: number; name: string }[] }

export function People() {
  const orgId = Number(useParams().orgId);
  const o = orgApi(orgId);
  const { isOwner, isManager } = useOrg(orgId);
  const { user } = useSession();
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invite, setInvite] = useState({ email: '', role: 'employee' as Role });
  const [inviteErr, setInviteErr] = useState('');
  const [team, setTeam] = useState({ name: '', memberIds: [] as number[] });

  const load = useCallback(() => {
    api.get<{ members: Member[] }>(o('/members')).then((r) => setMembers(r.members));
    api.get<{ teams: Team[] }>(o('/teams')).then((r) => setTeams(r.teams));
  }, [orgId]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setInviteErr('');
    try {
      const r = await api.post<{ member: Member }>(o('/members'), invite);
      toast({ tone: 'ok', text: `${r.member.name} has joined as ${invite.role}.` });
      setInvite({ email: '', role: 'employee' });
      load();
    } catch (err) { if (err instanceof ApiError) setInviteErr(err.message); }
  }
  async function changeRole(m: Member, role: Role) {
    try { await api.patch(o(`/members/${m.id}`), { role }); toast({ tone: 'ok', text: `${m.name} is now ${role === 'owner' ? 'an owner' : `a ${role}`}.` }); load(); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); load(); }
  }
  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.name} from the organisation? Their unfinished tasks will become unassigned.`)) return;
    try { await api.del(o(`/members/${m.id}`)); toast({ tone: 'ok', text: `${m.name} has been removed.` }); load(); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }
  async function addTeam(e: FormEvent) {
    e.preventDefault();
    try { await api.post(o('/teams'), team); setTeam({ name: '', memberIds: [] }); load(); toast({ tone: 'ok', text: 'Team created' }); }
    catch (err: any) { toast({ tone: 'warn', text: err.details?.name ?? err.message }); }
  }

  if (!members) return <Spinner />;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="lede">{members.length} {members.length === 1 ? 'person' : 'people'} in this organisation.</p>
        </div>
      </header>

      <div className="two-col">
        <div className="card">
          <ul className="people-list">
            {members.map((m) => (
              <li key={m.id}>
                <Avatar name={m.name} size={36} />
                <div className="grow">
                  <strong>{m.name}{m.id === user?.id && ' (you)'}</strong>
                  <span className="muted small">{m.email} · {m.open_tasks ? `${m.open_tasks} open ${m.open_tasks === 1 ? 'task' : 'tasks'}` : 'no open tasks'}</span>
                </div>
                {isOwner ? (
                  <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} aria-label={`Role for ${m.name}`}>
                    <option value="owner">Owner</option><option value="manager">Manager</option><option value="employee">Employee</option>
                  </select>
                ) : <span className={`pill role-${m.role}`}>{m.role}</span>}
                {isOwner && m.id !== user?.id && <button className="icon-btn" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}><Icon name="trash" size={16} /></button>}
              </li>
            ))}
          </ul>
        </div>

        <div className="stack">
          {isOwner && (
            <form className="card" onSubmit={add}>
              <h3>Add someone</h3>
              <p className="muted small">They need to have signed up first. Then add them here with their email.</p>
              <Field label="Their email" error={inviteErr}><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
              <Field label="Role" hint={ROLE_HELP[invite.role]}>
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}>
                  <option value="employee">Employee</option><option value="manager">Manager</option><option value="owner">Owner</option>
                </select>
              </Field>
              <button className="btn btn-primary btn-block" disabled={!invite.email}>Add to organisation</button>
            </form>
          )}
          <div className="card">
            <h3>Teams</h3>
            {teams.length === 0 ? <p className="muted small">No teams yet. Teams make it quick to add a group to a new project.</p> : (
              <ul className="team-list">
                {teams.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>
                    <span className="avatar-stack">{t.members.map((m) => <Avatar key={m.id} name={m.name} size={24} />)}</span>
                  </li>
                ))}
              </ul>
            )}
            {isManager && (
              <form onSubmit={addTeam} className="team-form">
                <Field label="New team"><input value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="e.g. Design" /></Field>
                <div className="people-pick">
                  {members.map((m) => (
                    <label key={m.id} className="person-check">
                      <input type="checkbox" checked={team.memberIds.includes(m.id)}
                        onChange={() => setTeam((t) => ({ ...t, memberIds: t.memberIds.includes(m.id) ? t.memberIds.filter((x) => x !== m.id) : [...t.memberIds, m.id] }))} />
                      {m.name}
                    </label>
                  ))}
                </div>
                <button className="btn btn-block" disabled={!team.name.trim()}>Create team</button>
              </form>
            )}
          </div>
        </div>
      </div>

      <section className="card perm" aria-labelledby="perm-title">
        <h3 id="perm-title">Who can do what</h3>
        <p className="muted">The server checks every one of these on each request, so hiding a button is never the only protection.</p>
        <div className="table-scroll">
        <table className="table perm-table">
          <thead><tr><th>Action</th><th>Owner</th><th>Manager</th><th>Employee</th></tr></thead>
          <tbody>
            {PERMISSIONS.map(([action, owner, manager, employee]) => (
              <tr key={action}>
                <td>{action}</td>
                {[owner, manager, employee].map((v, i) => (
                  <td key={i} className={`perm-cell ${v === true ? 'yes' : v === false ? 'no' : 'some'}`}>
                    {v === true ? <><Icon name="check" size={15} /><span className="sr-only">Yes</span></>
                      : v === false ? <><span aria-hidden>–</span><span className="sr-only">No</span></>
                      : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="muted small">Someone from another organisation can do none of these. To them, your projects, tasks and files do not exist.</p>
      </section>
    </div>
  );
}

type Cell = boolean | string;
const PERMISSIONS: [string, Cell, Cell, Cell][] = [
  ['See projects', 'All', 'All', 'Only ones they are on'],
  ['Create, edit and archive projects', true, true, false],
  ['Add or remove people on a project', true, true, false],
  ['Create workspaces and milestones', true, true, false],
  ['Delete an empty workspace', true, false, false],
  ['Create and edit tasks, move cards', true, true, 'In their projects'],
  ['Comment and attach files', true, true, 'In their projects'],
  ['Remove a task', true, true, 'Only tasks they created'],
  ['Delete a comment or file', true, true, 'Only their own'],
  ['See reports', true, true, false],
  ['Create teams', true, true, false],
  ['Invite people, change roles, remove people', true, false, false],
];

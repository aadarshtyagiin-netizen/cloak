import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, adminApi } from '../../lib/api';
import { decodeJwtRole } from '../../lib/jwt';
import { useAuth } from '../../store/auth';
import { useUI } from '../../store/ui';
import { EmptyState, Modal, Spinner, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';
import type { UnmaskResult } from '../../types';

type Tab = 'overview' | 'reports' | 'confessions' | 'audit';

export function AdminPage(): JSX.Element {
  const { openSidebar } = useShell();
  const role = decodeJwtRole(useAuth((s) => s.accessToken));
  const [tab, setTab] = useState<Tab>('overview');

  if (role === 'USER') {
    return <EmptyState icon="🔒" title="Admins only" hint="You don't have permission to view the moderation dashboard." />;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'reports', label: 'Reports' },
    { id: 'confessions', label: 'Confessions' },
    ...(role === 'ADMIN' ? [{ id: 'audit' as Tab, label: 'Audit log' }] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>☰ Menu</button>
        <h1 className="mb-1 text-xl font-extrabold">🛡️ Moderation dashboard</h1>
        <p className="mb-4 text-sm text-ink-soft">Signed in as {role}. Identity unmasks are admin-only and always audited.</p>

        <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1 text-sm">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx('rounded-lg px-3 py-1.5', tab === t.id ? 'bg-brand-600 text-white' : 'text-ink-soft hover:text-ink')}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? <Overview /> : null}
        {tab === 'reports' ? <Reports isAdmin={role === 'ADMIN'} /> : null}
        {tab === 'confessions' ? <Confessions /> : null}
        {tab === 'audit' ? <Audit /> : null}
      </div>
    </div>
  );
}

function Overview(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.stats });
  if (isLoading || !data) return <Spinner />;
  const cards: [string, number, string][] = [
    ['Users', data.users, '👥'],
    ['Messages', data.messages, '💬'],
    ['Channels', data.channels, '#️⃣'],
    ['Open reports', data.openReports, '🚩'],
    ['Messages (24h)', data.messages24h, '📈'],
    ['Active users (24h)', data.dau, '🟢'],
    ['Voice rooms', data.activeVoiceRooms, '🎧'],
    ['Video rooms', data.activeVideoRooms, '📹'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(([label, value, icon]) => (
        <div key={label} className="card p-4">
          <div className="text-xl">{icon}</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
          <div className="text-xs text-ink-soft">{label}</div>
        </div>
      ))}
    </div>
  );
}

function Reports({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [unmask, setUnmask] = useState<UnmaskResult | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin-reports'], queryFn: () => adminApi.reports('OPEN') });

  const act = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => {
        pushToast('success', ok);
        void qc.invalidateQueries({ queryKey: ['admin-reports'] });
      })
      .catch((err) => pushToast('error', err instanceof ApiError ? err.message : 'Action failed.'));

  const doUnmask = (profileId: string) =>
    adminApi
      .unmask(profileId)
      .then((r) => setUnmask(r))
      .catch((err) => pushToast('error', err instanceof ApiError ? err.message : 'Unmask failed.'));

  if (isLoading) return <Spinner />;
  const reports = data?.data ?? [];
  if (reports.length === 0) return <EmptyState icon="✅" title="No open reports" hint="The queue is clear." />;

  return (
    <div className="space-y-3">
      {reports.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>{r.targetType} · reported by {r.reporter?.username ?? '—'}</span>
            <span>{new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="mt-1 text-sm font-medium">Reason: {r.reason}</p>
          {r.messageSnippet ? <p className="mt-1 rounded-lg bg-surface-3 p-2 text-sm">“{r.messageSnippet}”</p> : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button className="btn-subtle px-2 py-1" onClick={() => act(() => adminApi.resolveReport(r.id, 'RESOLVED'), 'Resolved')}>Resolve</button>
            <button className="btn-ghost px-2 py-1" onClick={() => act(() => adminApi.resolveReport(r.id, 'DISMISSED'), 'Dismissed')}>Dismiss</button>
            {r.targetMessageId ? (
              <button className="btn-ghost px-2 py-1 text-rose-400" onClick={() => act(() => adminApi.deleteMessage(r.targetMessageId!, `report ${r.id}`), 'Message removed')}>Delete message</button>
            ) : null}
            {r.targetProfile ? (
              <>
                <button className="btn-ghost px-2 py-1 text-amber-400" onClick={() => act(() => adminApi.userAction(r.targetProfile!.id, 'SUSPEND', `report ${r.id}`), 'User suspended')}>Suspend</button>
                <button className="btn-ghost px-2 py-1 text-rose-400" onClick={() => act(() => adminApi.userAction(r.targetProfile!.id, 'BAN', `report ${r.id}`), 'User banned')}>Ban</button>
                {isAdmin ? (
                  <button className="btn-ghost px-2 py-1" onClick={() => doUnmask(r.targetProfile!.id)}>🔓 Unmask</button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ))}

      <Modal open={!!unmask} onClose={() => setUnmask(null)} title="Identity (audited)">
        {unmask ? (
          <div className="space-y-1 text-sm">
            <p className="mb-2 text-xs text-rose-400">This lookup was written to the audit log.</p>
            <Row k="Anonymous handle" v={unmask.username} />
            <Row k="Email" v={unmask.email} />
            <Row k="Employee ID" v={unmask.employeeId ?? '—'} />
            <Row k="Role" v={unmask.role} />
            <Row k="Status" v={unmask.status} />
            <Row k="Joined" v={new Date(unmask.joinedAt).toLocaleString()} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-soft">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Confessions(): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({ queryKey: ['admin-confessions'], queryFn: adminApi.pendingConfessions });
  const moderate = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => adminApi.moderateConfession(v.id, v.approve),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-confessions'] }),
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Failed.'),
  });

  if (isLoading) return <Spinner />;
  const items = data?.data ?? [];
  if (items.length === 0) return <EmptyState icon="🤫" title="Nothing to review" hint="Pending confessions appear here." />;

  return (
    <div className="space-y-3">
      {items.map((c) => (
        <div key={c.id} className="card p-4">
          <p className="whitespace-pre-wrap text-sm">{c.body}</p>
          <div className="mt-3 flex gap-2 text-xs">
            <button className="btn-primary px-3 py-1" onClick={() => moderate.mutate({ id: c.id, approve: true })}>Approve</button>
            <button className="btn-ghost px-3 py-1 text-rose-400" onClick={() => moderate.mutate({ id: c.id, approve: false })}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Audit(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['admin-audit'], queryFn: adminApi.audit });
  if (isLoading) return <Spinner />;
  const rows = data?.data ?? [];
  return (
    <div className="space-y-1">
      {rows.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
          <span className="font-medium">{a.action}</span>
          <span className="text-xs text-ink-soft">{a.subjectType}:{a.subjectId.slice(0, 8)} · {new Date(a.createdAt).toLocaleString()}</span>
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm text-ink-soft">No audit entries yet.</p> : null}
    </div>
  );
}

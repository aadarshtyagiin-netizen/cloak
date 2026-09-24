import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, channelExtrasApi } from '../../lib/api';
import { decodeJwtRole } from '../../lib/jwt';
import { useAuth } from '../../store/auth';
import { useNotifications } from '../../store/notifications';
import { useUI } from '../../store/ui';
import { Logo, Modal, cx } from '../../components/ui';
import { SelfCard } from './SelfCard';
import type { PublicChannel } from '../../types';

const NAV = [
  { to: '/', icon: '🏠', label: 'Home', end: true },
  { to: '/search', icon: '🔍', label: 'Search' },
  { to: '/dm', icon: '✉️', label: 'Direct Messages' },
  { to: '/notifications', icon: '🔔', label: 'Notifications', badge: true },
  { to: '/bookmarks', icon: '🔖', label: 'Bookmarks' },
  { to: '/leaderboard', icon: '🏆', label: 'Leaderboard' },
  { to: '/community', icon: '✨', label: 'Community' },
] as const;

const ROOMS = [
  { to: '/rooms/voice', icon: '🎧', label: 'Voice Rooms' },
  { to: '/rooms/video', icon: '📹', label: 'Video Rooms' },
];

export function Sidebar({
  channels,
  mobileOpen,
  onCloseMobile,
}: {
  channels: PublicChannel[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const unread = useNotifications((s) => s.unread);
  const role = decodeJwtRole(useAuth((s) => s.accessToken));
  const filtered = channels.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    cx(
      'group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition',
      isActive ? 'bg-brand-600/15 text-ink' : 'text-ink-soft hover:bg-surface-3 hover:text-ink',
    );

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onCloseMobile} aria-hidden />
      ) : null}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-surface-2 p-3 transition-transform md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-1 py-2">
          <Logo className="text-lg" />
          <span className="rounded-full bg-brand-600/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">
            anonymous
          </span>
        </div>

        <input
          className="input mt-2 py-2 text-sm"
          placeholder="Search channels…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <nav className="mt-4 flex-1 overflow-y-auto pr-1">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={'end' in item ? item.end : false} className={linkClass} onClick={onCloseMobile}>
                  <span>{item.icon}</span>
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {'badge' in item && item.badge && unread > 0 ? (
                    <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Channels</span>
            <button
              className="text-ink-soft hover:text-ink"
              title="Create channel"
              onClick={() => setCreating(true)}
            >
              ＋
            </button>
          </div>
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <NavLink to={`/c/${c.id}`} className={linkClass} onClick={onCloseMobile}>
                  <span className="text-ink-soft">#</span>
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  {c.isSystem ? <span title="System channel">📌</span> : null}
                </NavLink>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-ink-soft">No channels match “{query}”.</li>
            ) : null}
          </ul>

          <div className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Live rooms
          </div>
          <ul className="space-y-0.5">
            {ROOMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={linkClass} onClick={onCloseMobile}>
                  <span>{item.icon}</span>
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                </NavLink>
              </li>
            ))}
            {role !== 'USER' ? (
              <li>
                <NavLink to="/admin" className={linkClass} onClick={onCloseMobile}>
                  <span>🛡️</span>
                  <span className="flex-1 truncate font-medium">Admin</span>
                </NavLink>
              </li>
            ) : null}
          </ul>
        </nav>

        <SelfCard />
      </aside>

      <CreateChannelModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateChannelModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

  async function create(): Promise<void> {
    if (slug.length < 2) {
      pushToast('error', 'Channel name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await channelExtrasApi.create({ slug, name: name.trim(), description: description.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['channels'] });
      pushToast('success', `Created #${res.channel.name}`);
      setName('');
      setDescription('');
      onClose();
      navigate(`/c/${res.channel.id}`);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not create channel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a channel">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input className="input py-2 text-sm" placeholder="design" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {slug ? <p className="mt-1 text-xs text-ink-soft">Will be created as #{slug}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Description <span className="text-ink-soft">(optional)</span></label>
          <input
            className="input py-2 text-sm"
            placeholder="What's this channel about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => void create()} disabled={busy || slug.length < 2}>
          Create channel
        </button>
      </div>
    </Modal>
  );
}

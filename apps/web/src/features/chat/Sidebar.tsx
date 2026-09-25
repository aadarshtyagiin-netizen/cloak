import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Home,
  Search,
  Mail,
  Bell,
  Bookmark,
  Trophy,
  Sparkles,
  Headphones,
  Video,
  Shield,
  Plus,
  Hash,
  Pin,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, channelExtrasApi } from '../../lib/api';
import { decodeJwtRole } from '../../lib/jwt';
import { useAuth } from '../../store/auth';
import { useNotifications } from '../../store/notifications';
import { useUI } from '../../store/ui';
import { Logo, Modal, cx } from '../../components/ui';
import { SelfCard } from './SelfCard';
import type { PublicChannel } from '../../types';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  badge?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/dm', icon: Mail, label: 'Direct Messages' },
  { to: '/notifications', icon: Bell, label: 'Notifications', badge: true },
  { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
  { to: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { to: '/community', icon: Sparkles, label: 'Community' },
];

const ROOMS: NavItem[] = [
  { to: '/rooms/voice', icon: Headphones, label: 'Voice Rooms' },
  { to: '/rooms/video', icon: Video, label: 'Video Rooms' },
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
      'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
      'before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-brand-500 before:opacity-0 before:transition-opacity',
      isActive
        ? 'bg-surface-3 font-semibold text-ink before:opacity-100'
        : 'text-ink-soft hover:bg-surface-3/60 hover:text-ink',
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
          <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">
            anonymous
          </span>
        </div>

        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            className="input py-2 pl-9 text-sm"
            placeholder="Search channels…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto pr-1">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end ?? false} className={linkClass} onClick={onCloseMobile}>
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && unread > 0 ? (
                      <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Channels</span>
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-ink-soft transition hover:bg-surface-3 hover:text-ink"
              title="Create channel"
              aria-label="Create channel"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <NavLink to={`/c/${c.id}`} className={linkClass} onClick={onCloseMobile}>
                  <Hash className="h-[18px] w-[18px] shrink-0 text-ink-soft" />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.isSystem ? <Pin className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-label="System channel" /> : null}
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
            {ROOMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink to={item.to} className={linkClass} onClick={onCloseMobile}>
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
            {role !== 'USER' ? (
              <li>
                <NavLink to="/admin" className={linkClass} onClick={onCloseMobile}>
                  <Shield className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">Admin</span>
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

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, authApi, identityApi, moderationApi, notificationsApi, profilesApi, uploadMedia } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useUI } from '../../store/ui';
import { Avatar, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';
import type { NotificationLevel } from '../../types';

export function SettingsPage(): JSX.Element {
  const { openSidebar } = useShell();
  const profile = useAuth((s) => s.profile);
  const setProfile = useAuth((s) => s.setProfile);
  const clear = useAuth((s) => s.clear);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const pushToast = useUI((s) => s.pushToast);
  const soundEnabled = useUI((s) => s.soundEnabled);
  const browserEnabled = useUI((s) => s.browserEnabled);
  const toggleSound = useUI((s) => s.toggleSound);
  const toggleBrowser = useUI((s) => s.toggleBrowser);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);

  const blocks = useQuery({ queryKey: ['blocks'], queryFn: moderationApi.blocks });
  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: notificationsApi.getPreferences });

  if (!profile) return <div className="p-8 text-ink-soft">Loading…</div>;

  async function saveUsername(): Promise<void> {
    if (username.trim() === profile?.username) return;
    setBusy(true);
    try {
      const res = await identityApi.setUsername(username.trim());
      setProfile(res.profile);
      pushToast('success', 'Username updated');
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not update username.');
    } finally {
      setBusy(false);
    }
  }

  async function saveBio(): Promise<void> {
    setBusy(true);
    try {
      const res = await profilesApi.updateMe({ bio: bio.trim() });
      setProfile(res.profile);
      pushToast('success', 'Bio saved');
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not save bio.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePresence(): Promise<void> {
    try {
      const res = await profilesApi.updateMe({ presenceVisible: profile!.presence === 'OFFLINE' ? true : undefined });
      setProfile(res.profile);
    } catch {
      /* ignore */
    }
  }

  async function regenerate(): Promise<void> {
    setBusy(true);
    try {
      const res = await identityApi.regenerate();
      setProfile(res.profile);
      setUsername(res.profile.username);
      pushToast('success', `You are now ${res.profile.username}`);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not regenerate.');
    } finally {
      setBusy(false);
    }
  }

  async function unblock(id: string): Promise<void> {
    try {
      await moderationApi.toggleBlock(id);
      void qc.invalidateQueries({ queryKey: ['blocks'] });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not unblock.');
    }
  }

  async function uploadAvatar(file: File): Promise<void> {
    setBusy(true);
    try {
      const att = await uploadMedia(file);
      const res = await profilesApi.updateMe({ avatarKind: 'UPLOADED', avatarUrl: att.url });
      setProfile(res.profile);
      pushToast('success', 'Avatar updated');
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not upload avatar.');
    } finally {
      setBusy(false);
    }
  }

  async function useGeneratedAvatar(): Promise<void> {
    try {
      const res = await profilesApi.updateMe({ avatarKind: 'GENERATED', avatarUrl: null });
      setProfile(res.profile);
    } catch {
      /* ignore */
    }
  }

  async function setGlobalLevel(level: NotificationLevel): Promise<void> {
    try {
      await notificationsApi.setPreference(null, level);
      void qc.invalidateQueries({ queryKey: ['notif-prefs'] });
      pushToast('success', 'Notification preference saved');
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not save preference.');
    }
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
        <div>
          <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
            ☰ Menu
          </button>
          <h1 className="text-xl font-extrabold">⚙️ Settings</h1>
        </div>

        <Section title="Identity">
          <div className="flex items-center gap-3">
            <Avatar seed={profile.avatarSeed} username={profile.username} size="lg" url={profile.avatarUrl} />
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">Anonymous username</label>
              <div className="flex gap-2">
                <input className="input py-2 text-sm" value={username} onChange={(e) => setUsername(e.target.value)} />
                <button className="btn-subtle" onClick={() => void saveUsername()} disabled={busy}>Save</button>
              </div>
              <p className="mt-1 text-xs text-ink-soft">3–24 letters, numbers or underscores. Must be unique.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => void regenerate()} disabled={busy}>
              🎲 New random identity
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              🖼️ Upload avatar
            </button>
            {profile.avatarKind === 'UPLOADED' ? (
              <button className="btn-ghost" onClick={() => void useGeneratedAvatar()}>Use generated avatar</button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = '';
              }}
            />
          </div>
        </Section>

        <Section title="Notifications">
          <Row label="Sound" hint="Play a chime for new notifications.">
            <Toggle on={soundEnabled} onClick={toggleSound} />
          </Row>
          <Row label="Browser notifications" hint="Desktop pop-ups when the tab is in the background.">
            <Toggle on={browserEnabled} onClick={toggleBrowser} />
          </Row>
          <div className="mt-3">
            <div className="mb-1 text-sm font-medium">What to notify me about</div>
            <div className="flex flex-wrap gap-1">
              {(['ALL', 'MENTIONS', 'IMPORTANT', 'NOTHING'] as NotificationLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => void setGlobalLevel(lvl)}
                  className={cx(
                    'rounded-lg px-3 py-1 text-xs transition',
                    (prefs.data?.global ?? 'ALL') === lvl ? 'bg-brand-600 text-white' : 'bg-surface-3 text-ink-soft hover:text-ink',
                  )}
                >
                  {lvl === 'ALL' ? 'All' : lvl === 'MENTIONS' ? 'Mentions only' : lvl === 'IMPORTANT' ? 'Important' : 'Nothing'}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Profile">
          <label className="mb-1 block text-sm font-medium">Bio</label>
          <textarea
            className="input py-2 text-sm"
            rows={3}
            maxLength={280}
            placeholder="Tell the community about your anonymous self…"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button className="btn-subtle" onClick={() => void saveBio()} disabled={busy}>Save bio</button>
          </div>
        </Section>

        <Section title="Appearance">
          <Row label="Theme" hint="Switch between dark and light mode.">
            <button className="btn-subtle" onClick={toggleTheme}>
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </Row>
        </Section>

        <Section title="Privacy">
          <Row label="Show my online status" hint="When off, you appear offline to others.">
            <Toggle on={profile.presence !== 'OFFLINE'} onClick={() => void togglePresence()} />
          </Row>
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Blocked users</div>
            {blocks.data && blocks.data.data.length > 0 ? (
              <ul className="space-y-1">
                {blocks.data.data.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 rounded-lg bg-surface p-2">
                    <Avatar seed={b.avatarSeed} username={b.username} size="sm" />
                    <span className="flex-1 text-sm">{b.username}</span>
                    <button className="text-xs text-ink-soft hover:text-ink" onClick={() => void unblock(b.id)}>
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">You haven't blocked anyone.</p>
            )}
          </div>
        </Section>

        <Section title="Account">
          <button className="btn-ghost text-rose-400" onClick={() => void logout()}>⎋ Log out</button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-soft">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-ink-soft">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cx('relative h-6 w-11 rounded-full transition', on ? 'bg-brand-600' : 'bg-surface-3')}
      role="switch"
      aria-checked={on}
    >
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

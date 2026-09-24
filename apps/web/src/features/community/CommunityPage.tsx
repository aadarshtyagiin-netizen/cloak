import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, communityApi } from '../../lib/api';
import { useUI } from '../../store/ui';
import { Avatar, Spinner, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';

type Tab = 'icebreaker' | 'confessions' | 'events' | 'meet';

export function CommunityPage(): JSX.Element {
  const { openSidebar } = useShell();
  const [tab, setTab] = useState<Tab>('icebreaker');
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'icebreaker', label: 'Question of the day', icon: '💡' },
    { id: 'confessions', label: 'Confessions', icon: '🤫' },
    { id: 'events', label: 'Events', icon: '📅' },
    { id: 'meet', label: 'Meet someone', icon: '🎲' },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>☰ Menu</button>
        <h1 className="mb-4 text-xl font-extrabold">✨ Community</h1>
        <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1 text-sm">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx('rounded-lg px-3 py-1.5 transition', tab === t.id ? 'bg-brand-600 text-white' : 'text-ink-soft hover:text-ink')}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'icebreaker' ? <Icebreaker /> : null}
        {tab === 'confessions' ? <Confessions /> : null}
        {tab === 'events' ? <Events /> : null}
        {tab === 'meet' ? <MeetSomeone /> : null}
      </div>
    </div>
  );
}

function Icebreaker(): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [answer, setAnswer] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['icebreaker'], queryFn: communityApi.icebreaker });
  const submit = useMutation({
    mutationFn: (body: string) => communityApi.answerIcebreaker(body),
    onSuccess: () => {
      setAnswer('');
      void qc.invalidateQueries({ queryKey: ['icebreaker'] });
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not submit.'),
  });

  if (isLoading || !data) return <Spinner />;
  return (
    <div>
      <div className="card mb-4 p-5">
        <p className="text-sm text-ink-soft">Question of the day</p>
        <h2 className="mt-1 text-lg font-bold">{data.prompt}</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="input py-2 text-sm"
            placeholder={data.myAnswer ? 'Update your answer…' : 'Share your answer…'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button className="btn-primary" onClick={() => answer.trim() && submit.mutate(answer.trim())} disabled={submit.isPending}>
            {data.myAnswer ? 'Update' : 'Answer'}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {data.answers.map((a) => (
          <div key={a.id} className="flex gap-2 rounded-xl border border-line p-3">
            <Avatar seed={a.author.avatarSeed} username={a.author.username} size="sm" />
            <div>
              <div className="text-xs font-semibold">{a.author.username}</div>
              <p className="text-sm">{a.body}</p>
            </div>
          </div>
        ))}
        {data.answers.length === 0 ? <p className="text-sm text-ink-soft">Be the first to answer.</p> : null}
      </div>
    </div>
  );
}

function Confessions(): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [body, setBody] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['confessions'], queryFn: communityApi.confessions });
  const submit = useMutation({
    mutationFn: (b: string) => communityApi.submitConfession(b),
    onSuccess: () => {
      setBody('');
      pushToast('success', 'Sent for moderation. It appears once approved.');
      void qc.invalidateQueries({ queryKey: ['confessions'] });
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not submit.'),
  });

  return (
    <div>
      <div className="card mb-4 p-4">
        <p className="mb-2 text-sm text-ink-soft">Post something anonymously. A moderator reviews it before it goes public — even we don't show who wrote it.</p>
        <textarea className="input py-2 text-sm" rows={3} placeholder="Confess something…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-2 flex justify-end">
          <button className="btn-primary" onClick={() => body.trim() && submit.mutate(body.trim())} disabled={submit.isPending}>
            Submit
          </button>
        </div>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {(data?.data ?? []).map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-surface-2 p-4">
              <span className="text-lg">🤫</span>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}
          {(data?.data ?? []).length === 0 ? <p className="text-sm text-ink-soft">No confessions yet.</p> : null}
        </div>
      )}
    </div>
  );
}

function Events(): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['events'], queryFn: communityApi.events });
  const create = useMutation({
    mutationFn: () => communityApi.createEvent({ title: title.trim(), startsAt: new Date(startsAt).toISOString() }),
    onSuccess: () => {
      setTitle('');
      setStartsAt('');
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not create event.'),
  });
  const rsvp = useMutation({
    mutationFn: (v: { id: string; status: 'GOING' | 'MAYBE' | 'NOT_GOING' }) => communityApi.rsvp(v.id, v.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });

  return (
    <div>
      <div className="card mb-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input py-2 text-sm" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input py-2 text-sm" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className="mt-2 flex justify-end">
          <button className="btn-primary" onClick={() => title.trim() && startsAt && create.mutate()} disabled={create.isPending}>
            Create event
          </button>
        </div>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {(data?.data ?? []).map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{e.title}</div>
                  <div className="text-xs text-ink-soft">{new Date(e.startsAt).toLocaleString()} · by {e.createdBy.username}</div>
                </div>
                <span className="text-xs text-ink-soft">✅ {e.counts.going} going</span>
              </div>
              <div className="mt-3 flex gap-1">
                {(['GOING', 'MAYBE', 'NOT_GOING'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => rsvp.mutate({ id: e.id, status: st })}
                    className={cx('rounded-lg px-2 py-1 text-xs', e.myStatus === st ? 'bg-brand-600 text-white' : 'bg-surface-3 text-ink-soft hover:text-ink')}
                  >
                    {st === 'GOING' ? 'Going' : st === 'MAYBE' ? 'Maybe' : "Can't"}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {(data?.data ?? []).length === 0 ? <p className="text-sm text-ink-soft">No upcoming events.</p> : null}
        </div>
      )}
    </div>
  );
}

function MeetSomeone(): JSX.Element {
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);
  const { data, refetch } = useQuery({ queryKey: ['pairing'], queryFn: communityApi.pairingStatus, refetchInterval: (q) => (q.state.data?.status === 'WAITING' ? 3000 : false) });
  const join = useMutation({
    mutationFn: () => communityApi.joinPairing(),
    onSuccess: (res) => {
      if (res.status === 'MATCHED' && res.threadId) {
        pushToast('success', `Matched with ${res.other?.username ?? 'someone'}!`);
        navigate(`/dm/${res.threadId}`);
      } else {
        void refetch();
      }
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not join.'),
  });
  const leave = useMutation({ mutationFn: () => communityApi.leavePairing(), onSuccess: () => refetch() });

  const matched = data?.status === 'MATCHED';
  const waiting = data?.status === 'WAITING' && join.isSuccess;

  return (
    <div className="card p-6 text-center">
      <div className="text-4xl">🎲</div>
      <h2 className="mt-2 text-lg font-bold">Random pair chat</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
        Get matched with another anonymous community member for a 1:1 chat. Great for meeting people across teams.
      </p>
      {matched && data?.other && data.threadId ? (
        <button className="btn-primary mt-4" onClick={() => navigate(`/dm/${data.threadId}`)}>
          Open chat with {data.other.username} →
        </button>
      ) : waiting ? (
        <div className="mt-4">
          <p className="text-sm">Looking for a match… <Spinner /></p>
          <button className="btn-ghost mt-2" onClick={() => leave.mutate()}>Cancel</button>
        </div>
      ) : (
        <button className="btn-primary mt-4" onClick={() => join.mutate()} disabled={join.isPending}>
          Find me a match
        </button>
      )}
    </div>
  );
}

import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { channelsApi } from '../../lib/api';
import { EmptyState, Spinner } from '../../components/ui';
import { ChatView } from './ChatView';
import { useShell } from './AppShell';

/** Route wrapper for /c/:channelId — resolves the channel then renders chat. */
export function ChannelPage(): JSX.Element {
  const { channelId = '' } = useParams();
  const { channels, channelsLoading, openSidebar } = useShell();
  const fromList = channels.find((c) => c.id === channelId);

  const { data, isLoading } = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => channelsApi.get(channelId),
    enabled: !fromList && !!channelId,
  });

  const channel = fromList ?? data?.channel ?? null;

  if (channel) return <ChatView channel={channel} onOpenSidebar={openSidebar} />;
  if (channelsLoading || isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-soft">
        <Spinner />
      </div>
    );
  }
  return <EmptyState icon="🕳️" title="Channel not found" hint="It may be private or archived." />;
}

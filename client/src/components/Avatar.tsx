import { initials } from '../lib/format';

type Side = 'you' | 'them' | 'neutral';

export function Avatar({
  username,
  side = 'neutral',
  large = false,
}: {
  username: string;
  side?: Side;
  large?: boolean;
}) {
  const sideClass = side === 'neutral' ? '' : ` avatar-${side}`;
  return (
    <span className={`avatar${large ? ' avatar-lg' : ''}${sideClass}`} aria-hidden="true">
      {initials(username)}
    </span>
  );
}

export function OnlineDot({ online, label }: { online: boolean; label?: string }) {
  return (
    <span
      className={`dot${online ? ' dot-online' : ''}`}
      title={label ?? (online ? 'Online' : 'Offline')}
      role="img"
      aria-label={label ?? (online ? 'Online' : 'Offline')}
    />
  );
}

import { AnimalFace, isAvatarId } from './AnimalAvatar';
import { initials } from '../lib/format';

type Side = 'you' | 'them' | 'neutral';

export function Avatar({
  username,
  avatar,
  side = 'neutral',
  large = false,
}: {
  username: string;
  /** A preset animal id. Anything unknown falls back to initials. */
  avatar?: string | null;
  side?: Side;
  large?: boolean;
}) {
  const sideClass = side === 'neutral' ? '' : ` avatar-${side}`;
  const classes = `avatar${large ? ' avatar-lg' : ''}${sideClass}`;

  if (isAvatarId(avatar)) {
    return (
      <span className={`${classes} avatar-animal`} aria-hidden="true">
        <AnimalFace id={avatar} />
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden="true">
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

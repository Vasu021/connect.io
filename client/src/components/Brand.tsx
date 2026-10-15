import { Link } from 'react-router-dom';

/** The two overlapping rings are the whole idea in one mark: two minds, one overlap. */
export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="connect.io home">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>
        connect<em>.io</em>
      </span>
    </Link>
  );
}

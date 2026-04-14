import { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export default function AuthCard({ title, subtitle, children }: Props) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

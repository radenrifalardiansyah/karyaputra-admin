'use client';

interface Props {
  name: string;
  avatar?: string | null;
  size?: number;
}

export default function ChatAvatar({ name, avatar, size = 40 }: Props) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--accent), #15803D)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 800, color: 'white',
    }}>
      {avatar
        ? <img src={avatar} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : name[0]?.toUpperCase()}
    </div>
  );
}

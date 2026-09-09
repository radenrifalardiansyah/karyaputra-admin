'use client';

import { useEffect, useState } from 'react';
import { UserCog, X, Check, Loader2, Eye, EyeOff, Camera } from 'lucide-react';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';

// Firestore Timestamp serialized over JSON (Response.json()) lands as {seconds, nanoseconds}.
type SerializedTimestamp = { seconds: number; nanoseconds: number };
type LoginHistoryEntry = { id: string; ip: string | null; userAgent: string | null; createdAt: SerializedTimestamp | null };
type LoginHistoryResponse = { lastLoginAt: SerializedTimestamp | null; history: LoginHistoryEntry[] };

function formatLoginTime(ts: SerializedTimestamp | null | undefined) {
  if (!ts) return 'Belum ada data';
  return new Date(ts.seconds * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function describeUserAgent(ua: string | null | undefined) {
  if (!ua) return null;
  const os =
    /iPhone/i.test(ua) ? 'iPhone' :
    /iPad/i.test(ua) ? 'iPad' :
    /Android/i.test(ua) ? 'Android' :
    /Windows/i.test(ua) ? 'Windows' :
    /Macintosh|Mac OS X/i.test(ua) ? 'Mac' :
    /Linux/i.test(ua) ? 'Linux' : 'Perangkat lain';
  const browser =
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\//i.test(ua) || /Opera/i.test(ua) ? 'Opera' :
    /CriOS/i.test(ua) ? 'Chrome' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /FxiOS/i.test(ua) || /Firefox\//i.test(ua) ? 'Firefox' :
    /Safari\//i.test(ua) ? 'Safari' : 'Browser lain';
  return `${browser} · ${os}`;
}

interface Props {
  creds: string;
  username: string;
  role: string;
  email: string | null;
  avatar: string | null;
  onClose: () => void;
  onSaved: (patch: { email: string | null; avatar: string | null }) => void;
}

const compressImage = async (file: File): Promise<File> => {
  const MAX_PX = 400;
  const bitmap = await createImageBitmap(file);
  const scale  = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return new Promise(resolve =>
    canvas.toBlob(
      blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
      'image/jpeg', 0.85,
    ),
  );
};

export default function EditProfileModal({ creds, username, role, email, avatar, onClose, onSaved }: Props) {
  const toast   = useToast();
  const headers = { 'x-admin-auth': creds };

  const [avatarUrl, setAvatarUrl] = useState(avatar);
  const [uploading, setUploading] = useState(false);
  const [emailVal,  setEmailVal]  = useState(email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const [loginHistory, setLoginHistory] = useState<LoginHistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetch('/api/login-history', { headers })
      .then(r => r.json())
      .then((data: LoginHistoryResponse) => setLoginHistory(data))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch('/api/upload', { method: 'POST', headers, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      setAvatarUrl(url);
    } catch {
      toast.error('Gagal mengunggah foto profil.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setError('');
    if (newPassword && newPassword.length < 6) {
      setError('Password baru minimal 6 karakter.'); return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError('Konfirmasi password baru tidak cocok.'); return;
    }
    if (newPassword && !currentPassword) {
      setError('Masukkan password saat ini untuk mengubah password.'); return;
    }

    setSaving(true);
    const body: Record<string, unknown> = { email: emailVal || undefined, avatar: avatarUrl };
    if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword; }

    const r = await fetch('/api/me', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (r.ok) {
      onSaved({ email: emailVal ? emailVal.trim().toLowerCase() : null, avatar: avatarUrl });
      toast.success('Profil berhasil diperbarui.');
      onClose();
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal memperbarui profil.');
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><UserCog size={17} /></div>
            <div>
              <p className="modal-title">Edit Profil</p>
              <p className="modal-subtitle">{username}</p>
            </div>
          </div>
          <Tooltip label="Tutup"><button onClick={onClose} className="modal-close"><X size={14} /></button></Tooltip>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="flex justify-center">
              <label className="relative cursor-pointer" style={{ opacity: uploading ? 0.6 : 1 }}>
                <input
                  type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAvatar(f); }}
                />
                <div style={{
                  width: 76, height: 76, borderRadius: '50%', overflow: 'hidden',
                  background: 'linear-gradient(135deg, var(--accent), #15803D)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, fontWeight: 800, color: 'white',
                  boxShadow: '0 2px 10px rgba(212,105,30,0.30)',
                }}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : username[0].toUpperCase()}
                </div>
                <div style={{
                  position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: '50%',
                  background: 'var(--accent)', border: '2px solid var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                </div>
              </label>
            </div>

            <div>
              <label className="field-label">Username</label>
              <input value={username} disabled className="input" style={{ opacity: 0.6 }} />
            </div>

            <div>
              <label className="field-label">Role</label>
              <input value={role} disabled className="input" style={{ opacity: 0.6 }} />
            </div>

            <div>
              <label className="field-label">Email (opsional)</label>
              <input value={emailVal} onChange={e => setEmailVal(e.target.value)}
                className="input" placeholder="cth: budi@email.com" />
            </div>

            <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 14 }}>
              <p className="field-label" style={{ marginBottom: 10 }}>Ubah Password (opsional)</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type={showPassword ? 'text' : 'password'} value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="input" placeholder="Password saat ini"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'} value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input" style={{ paddingRight: 40 }} placeholder="Password baru"
                  />
                  <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input" placeholder="Konfirmasi password baru"
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 14 }}>
              <p className="field-label" style={{ marginBottom: 10 }}>Aktivitas Login</p>
              {loadingHistory ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Memuat riwayat login…</p>
              ) : (
                <>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Login terakhir: <strong>{formatLoginTime(loginHistory?.lastLoginAt)}</strong>
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                    {(loginHistory?.history.length ?? 0) === 0 && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Belum ada riwayat login 7 hari terakhir.</p>
                    )}
                    {loginHistory?.history.map(h => (
                      <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{formatLoginTime(h.createdAt)}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{h.ip ?? '-'}</span>
                        </div>
                        {describeUserAgent(h.userAgent) && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{describeUserAgent(h.userAgent)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {error && (
              <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
          <button onClick={save} disabled={saving || uploading}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { Monitor, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTheme, type ThemePreference } from '../theme';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function BusyMark() {
  return <span className="busy-mark" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'default' | 'large';
  busy?: boolean;
  busyLabel?: string;
};

export function Button({ variant = 'secondary', size = 'default', busy = false, busyLabel = 'Working…', className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx('button', `button-${variant}`, size !== 'default' && `button-${size}`, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{busy ? <><BusyMark /> {busyLabel}</> : children}</button>;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; bordered?: boolean };

export function IconButton({ label, bordered = true, className, type = 'button', ...props }: IconButtonProps) {
  return <button type={type} className={cx('icon-button', !bordered && 'icon-button-ghost', className)} aria-label={label} title={props.title ?? label} {...props} />;
}

const themeOrder: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const next = themeOrder[(themeOrder.indexOf(preference) + 1) % themeOrder.length]!;
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return <IconButton label={`Theme: ${preference}. Switch to ${next}.`} onClick={() => setPreference(next)}><Icon /></IconButton>;
}

export function InlineAlert({ children, tone = 'danger', onDismiss, className }: { children: ReactNode; tone?: 'danger' | 'info'; onDismiss?: () => void; className?: string }) {
  return <div className={cx('inline-alert', `inline-alert-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}><span>{children}</span>{onDismiss && <IconButton bordered={false} label="Dismiss message" onClick={onDismiss}><X /></IconButton>}</div>;
}

export function Dialog({ labelledBy, onClose, busy = false, overlayClassName = 'modal-backdrop', className = 'modal', children }: { labelledBy: string; onClose: () => void; busy?: boolean; overlayClassName?: string; className?: string; children: ReactNode }) {
  const surface = useRef<HTMLElement>(null);
  const state = useRef({ busy, onClose });
  state.current = { busy, onClose };
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    surface.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !state.current.busy) state.current.onClose();
      if (event.key !== 'Tab' || !surface.current) return;
      const focusable = Array.from(surface.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); surface.current.focus(); return; }
      const first = focusable[0]!; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return <div className={overlayClassName} role="presentation" onMouseDown={busy ? undefined : onClose}><section ref={surface} tabIndex={-1} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()}>{children}</section></div>;
}

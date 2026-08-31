import { Monitor, Moon, Sun, X } from 'lucide-react';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { EntityBranding } from '@bytecrunch/contracts-domain';
import loader from '../assets/loader.svg';
import defaultLogo from '../assets/logo.svg';
import { useTheme, type ThemePreference } from '../theme';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function BusyMark() {
  return <img className="busy-mark" src={loader} alt="" aria-hidden="true" />;
}

export function BrandIdentity({ branding, className }: { branding?: EntityBranding | null | undefined; className?: string }) {
  const name = branding?.displayName ?? 'BYTECRUNCH';
  const squareLogo = branding?.logoDataUrl ?? defaultLogo;
  return (
    <span className={cx('brand-identity', className)}>
      {branding?.markDataUrl ? (
        <>
          <img className="brand-lockup-image" src={branding.markDataUrl} alt={name} />
          <img className="brand-logo-image brand-compact-image" src={squareLogo} alt="" aria-hidden="true" />
        </>
      ) : (
        <>
          <img className="brand-logo-image" src={squareLogo} alt="" aria-hidden="true" />
          <strong className="brand-display-name">{name}</strong>
        </>
      )}
      <span className="brand-product-name">CONTRACTS</span>
    </span>
  );
}

export function PlatformCredit() {
  return <small className="platform-credit">© {new Date().getFullYear()} BYTECRUNCH</small>;
}

export function Eyebrow({ color = 'default', className, ...props }: HTMLAttributes<HTMLSpanElement> & { color?: 'default' | 'orange' | 'blue' }) {
  return <span className={cx('bc-eyebrow', color !== 'default' && `bc-text-${color}`, className)} {...props} />;
}

export function Badge({ tone = 'default', dot = false, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'solid' | 'orange' | 'blue' | 'success' | 'danger'; dot?: boolean }) {
  return <span className={cx('bc-badge', tone !== 'default' && `bc-badge--${tone}`, className)} {...props}>{dot && <i className="bc-badge__dot" aria-hidden="true" />}{children}</span>;
}

export function Card({ padded = true, raised = false, className, ...props }: HTMLAttributes<HTMLDivElement> & { padded?: boolean; raised?: boolean }) {
  return <div className={cx('bc-card', padded && 'bc-card--padded', raised && 'bc-card--raised', className)} {...props} />;
}

type FieldChrome = { label?: string; hint?: string; error?: string };
function FieldMessage({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  if (!hint && !error) return null;
  return <span id={id} className={cx('bc-hint', error && 'bc-hint--error')} role={error ? 'alert' : undefined}>{error ?? hint}</span>;
}

export function Input({ label, hint, error, id, className, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldChrome) {
  const generatedId = useId(); const inputId = id ?? generatedId; const messageId = `${inputId}-message`;
  return <div className="bc-field">{label && <label className="bc-label" htmlFor={inputId}>{label}</label>}<input id={inputId} className={cx('bc-input', error && 'bc-input--invalid', className)} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props} /><FieldMessage id={messageId} {...(hint ? { hint } : {})} {...(error ? { error } : {})} /></div>;
}

export function Textarea({ label, hint, error, id, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChrome) {
  const generatedId = useId(); const inputId = id ?? generatedId; const messageId = `${inputId}-message`;
  return <div className="bc-field">{label && <label className="bc-label" htmlFor={inputId}>{label}</label>}<textarea id={inputId} className={cx('bc-textarea', error && 'bc-textarea--invalid', className)} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props} /><FieldMessage id={messageId} {...(hint ? { hint } : {})} {...(error ? { error } : {})} /></div>;
}

export function Select({ label, hint, error, id, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & FieldChrome) {
  const generatedId = useId(); const inputId = id ?? generatedId; const messageId = `${inputId}-message`;
  return <div className="bc-field">{label && <label className="bc-label" htmlFor={inputId}>{label}</label>}<select id={inputId} className={cx('bc-select', error && 'bc-input--invalid', className)} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props}>{children}</select><FieldMessage id={messageId} {...(hint ? { hint } : {})} {...(error ? { error } : {})} /></div>;
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

# Bytecrunch Contracts design system

The application uses the Bytecrunch brand language: square geometry, hairline structure, restrained surfaces, orange for primary action, blue for information and focus, and monospace labels for technical metadata. The design system is a code boundary, not only a visual reference.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Color semantics | `apps/web/src/design-colors.css` | Brand ramps, light/dark semantic aliases, document-paper colors |
| Typography | `apps/web/src/design-typography.css` | Families, weights, sizes, line heights, tracking |
| Layout and motion | `apps/web/src/design-spacing.css` | Four-pixel spacing scale, radii, shadows, timing |
| Base behavior | `apps/web/src/design-base.css` | Resets, focus, selection, scrolling, reduced motion |
| Reusable components | `apps/web/src/design-components.css` and `components/ui.tsx` | Buttons, icon buttons, dialogs, loading marks, fields, badges, cards |
| Product composition | `apps/web/src/styles.css` | Contract-specific layouts and stateful product surfaces |

Components should consume semantic tokens such as `--surface-2`, `--text-3`, and `--border-1`. Raw colors are reserved for the token definitions and the theme-independent contract-paper surface. This keeps both themes coherent without making a legal document look like dark application chrome.

## Themes

`ThemeProvider` is mounted once at the application root and governs staff, recipient, membership-invitation, and external-review routes. The preference is `system`, `light`, or `dark`; system is the default and continues responding to operating-system changes. Explicit choices persist locally.

Do not set classes on `document.documentElement` from page components. Use `useTheme` or the shared `ThemeToggle`.

## Component rules

- Use `Button` for standard actions. Its `busy` state combines disabling, `aria-busy`, consistent copy, and the Bytecrunch 4×4 loading mark.
- Use `IconButton` for icon-only actions; its required `label` supplies an accessible name and tooltip.
- Use `Dialog` for overlays. It handles Escape, initial focus, focus containment, focus restoration, backdrop dismissal, and body scroll locking.
- Keep destructive actions explicit and use the danger variant only after the consequence is clear.
- Use native form controls and labels. Validation messages should use `role="alert"`; background status should use a polite live region.
- Prefer a reusable component over copying a class bundle when behavior, accessibility, or loading state is involved.

## Accessibility baseline

All interactive controls need a visible focus state and an accessible name. Keyboard and typed alternatives must exist for pointer/drawing interactions. Motion respects `prefers-reduced-motion`. Modal focus behavior is centralized, but each new workflow still requires keyboard, screen-reader, zoom, contrast, and touch testing.

## Adding a component

1. Confirm that it is repeated or owns behavior; page-only layout does not need a component.
2. Build its behavior and typed API in `components/`.
3. Add its reusable visual contract to `design-components.css` using semantic tokens.
4. Add page composition only to `styles.css`.
5. Exercise light, dark, and system themes plus keyboard and reduced-motion behavior.

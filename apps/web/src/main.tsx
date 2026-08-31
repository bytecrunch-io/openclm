import React from 'react';
import { createRoot } from 'react-dom/client';
import { DOCUMENT_PRESENTATION } from '@bytecrunch/contracts-domain';
import App from './App';
import { ThemeProvider } from './theme';
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-400-italic.css';
import '@fontsource/source-serif-4/latin-600.css';
import './styles.css';

const rootStyle = document.documentElement.style;
rootStyle.setProperty('--document-bg', DOCUMENT_PRESENTATION.paperBackground);
rootStyle.setProperty('--document-text', DOCUMENT_PRESENTATION.text);
rootStyle.setProperty('--document-muted', DOCUMENT_PRESENTATION.muted);
rootStyle.setProperty('--signature-ink', DOCUMENT_PRESENTATION.signatureInk);
rootStyle.setProperty('--document-paper-width', `${DOCUMENT_PRESENTATION.paperWidthPx}px`);
rootStyle.setProperty('--document-padding', `${DOCUMENT_PRESENTATION.paddingPx}px`);
rootStyle.setProperty('--document-font-size', `${DOCUMENT_PRESENTATION.bodyFontSizePx}px`);
rootStyle.setProperty('--document-line-height', String(DOCUMENT_PRESENTATION.lineHeight));
rootStyle.setProperty('--document-signature-gap', `${DOCUMENT_PRESENTATION.signatureGapPx}px`);
rootStyle.setProperty('--document-signature-height', `${DOCUMENT_PRESENTATION.signatureBlockHeightPx}px`);
rootStyle.setProperty('--document-signed-rule', DOCUMENT_PRESENTATION.signedRule);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import { html } from './lib/html.js';
import { App } from './App.js';

for (const href of ['./src/styles/tokens.css', './src/styles/ui.css', './src/styles/layout.css', './src/styles/pages.css']) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);

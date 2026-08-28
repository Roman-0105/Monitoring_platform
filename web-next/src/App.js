import React, { useEffect, useMemo, useState } from 'react';
import { html } from './lib/html.js';
import { Sidebar } from './layout/Sidebar.js';
import { Topbar } from './layout/Topbar.js';
import { NAV_SECTIONS } from './nav-config.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { canView, canEdit, ROLE_LABELS } from './lib/permissions.js';
import { ReadOnlyGate } from './components/ui.js';
import { PlaceholderPage } from './pages/Placeholder.js';
import { LoginPage } from './pages/Login.js';
import { RolesPage } from './pages/Roles.js';
import { OverviewPage } from './pages/Overview.js';
import { RegistryPage } from './pages/Registry.js';
import { Pit3DPage } from './pages/Pit3D.js';
import { PointsPage } from './pages/Points.js';
import { WellLevelsPage } from './pages/WellLevels.js';
import { WellsPage } from './pages/Wells.js';
import { StatsPage } from './pages/Stats.js';
import { DustJournalPage } from './pages/DustJournal.js';
import { DiagnosticsPage } from './pages/Diagnostics.js';
import { DewateringPage } from './pages/Dewatering.js';
import { MapPage } from './pages/Map.js';
import { WpMapPage } from './pages/WpMap.js';
import { SettingsPage } from './pages/Settings.js';
import { SumpForecastPage } from './pages/SumpForecast.js';
import { ReportPage } from './pages/Report.js';
import { ChemPage } from './pages/Chem.js';

const PILOT_PAGES = {
  overview: OverviewPage,
  registry: RegistryPage,
  pit3d: Pit3DPage,
  points: PointsPage,
  'well-levels': WellLevelsPage,
  wells: WellsPage,
  stats: StatsPage,
  dust: DustJournalPage,
  diag: DiagnosticsPage,
  dewatering: DewateringPage,
  map: MapPage,
  wpmap: WpMapPage,
  settings: SettingsPage,
  'sump-forecast': SumpForecastPage,
  report: ReportPage,
  chem: ChemPage,
  roles: RolesPage,
};

function findItem(key) {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.key === key) return { item, sectionLabel: section.label };
    }
  }
  return null;
}

function FullScreenMessage({ children }) {
  return html`
    <div style=${{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-sunken)', textAlign: 'center', padding: '24px' }}>
      <div style=${{ maxWidth: '360px', fontSize: '14px', color: 'var(--text-secondary)' }}>${children}</div>
    </div>
  `;
}

function AppShell() {
  const { profile, permMap, signOut } = useAuth();
  const role = profile.role;
  const isSuperAdmin = role === 'super_admin';

  function canViewKey(key) {
    if (key === 'roles') return isSuperAdmin;
    if (isSuperAdmin) return true;
    return canView(permMap, key);
  }
  function canEditKey(key) {
    if (isSuperAdmin) return true;
    return canEdit(permMap, key);
  }

  const filteredSections = useMemo(() => NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((it) => canViewKey(it.key)) }))
    .filter((section) => section.items.length > 0), [permMap, role]);

  const [activeKey, setActiveKey] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [quarry, setQuarry] = useState('ЮРГ');

  const { item, sectionLabel } = useMemo(() => findItem(activeKey) || {}, [activeKey]);
  const allowed = canViewKey(activeKey);
  const PageCmp = allowed ? PILOT_PAGES[activeKey] : null;

  const contentNoPad = allowed && (activeKey === 'pit3d' || activeKey === 'map' || activeKey === 'wpmap');

  return html`
    <div class="app-shell">
      <${Sidebar} sections=${filteredSections} collapsed=${collapsed} onToggleCollapsed=${() => setCollapsed((c) => !c)} activeKey=${activeKey} onNavigate=${setActiveKey} />
      <div class="app-main">
        <${Topbar} title=${item ? item.label : ''} crumb=${sectionLabel} quarry=${quarry} onQuarryChange=${setQuarry}
          userName=${profile.displayName} roleLabel=${ROLE_LABELS[role] || role} onSignOut=${signOut} />
        <div class=${'app-content' + (contentNoPad ? ' no-pad' : '')}>
          ${!allowed && html`
            <div style=${{ padding: '60px 24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div style=${{ fontSize: '15px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>Доступ запрещён</div>
              <div style=${{ fontSize: '13px' }}>У роли «${ROLE_LABELS[role] || role}» нет доступа к этому разделу.</div>
            </div>
          `}
          ${allowed && PageCmp && html`
            <${ReadOnlyGate} active=${!canEditKey(activeKey)}>
              <${PageCmp} quarry=${quarry} onNavigate=${setActiveKey} />
            <//>
          `}
          ${allowed && !PageCmp && html`<${PlaceholderPage} label=${item ? item.label : ''} />`}
        </div>
      </div>
    </div>
  `;
}

function AuthGate() {
  const { loading, session, profile, signOut } = useAuth();

  if (loading) return html`<${FullScreenMessage}>Загрузка…<//>`;
  if (!session) return html`<${LoginPage} />`;
  if (!profile || !profile.role || profile.active === false) {
    return html`
      <${FullScreenMessage}>
        Ваш аккаунт создан, но доступ к системе ещё не настроен администратором.
        <div style=${{ marginTop: '14px' }}>
          <button onClick=${signOut} style=${{ background: 'none', border: 'none', color: 'var(--gold-600, #a67c00)', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}>Выйти</button>
        </div>
      <//>
    `;
  }
  return html`<${AppShell} />`;
}

export function App() {
  return html`<${AuthProvider}><${AuthGate} /><//>`;
}

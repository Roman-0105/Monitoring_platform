import React, { useMemo, useState } from 'react';
import { html } from './lib/html.js';
import { Sidebar } from './layout/Sidebar.js';
import { Topbar } from './layout/Topbar.js';
import { NAV_SECTIONS } from './nav-config.js';
import { PlaceholderPage } from './pages/Placeholder.js';
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
};

function findItem(key) {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.key === key) return { item, sectionLabel: section.label };
    }
  }
  return null;
}

export function App() {
  const [activeKey, setActiveKey] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [quarry, setQuarry] = useState('ЮРГ');

  const { item, sectionLabel } = useMemo(() => findItem(activeKey) || {}, [activeKey]);
  const PageCmp = PILOT_PAGES[activeKey];

  const contentNoPad = activeKey === 'pit3d' || activeKey === 'map' || activeKey === 'wpmap';

  return html`
    <div class="app-shell">
      <${Sidebar} collapsed=${collapsed} onToggleCollapsed=${() => setCollapsed((c) => !c)} activeKey=${activeKey} onNavigate=${setActiveKey} />
      <div class="app-main">
        <${Topbar} title=${item ? item.label : ''} crumb=${sectionLabel} quarry=${quarry} onQuarryChange=${setQuarry} userName="Юкин Р.А." />
        <div class=${'app-content' + (contentNoPad ? ' no-pad' : '')}>
          ${PageCmp ? html`<${PageCmp} quarry=${quarry} onNavigate=${setActiveKey} />` : html`<${PlaceholderPage} label=${item ? item.label : ''} />`}
        </div>
      </div>
    </div>
  `;
}

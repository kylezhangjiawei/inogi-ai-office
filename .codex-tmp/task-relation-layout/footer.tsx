import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Link, useLocation } from 'react-router';
import { SiteRecordFooter } from '/src/app/components/SiteRecordFooter';
import '/src/styles/index.css';

const paths = ['/login', '/login/', '/login?from=%2Fproc-cockpit', '/', '/proc-cockpit', '/m', '/m/task/123', '/share/abc', '/login/details'];
function FooterFixture() {
  const location = useLocation();
  const [metrics, setMetrics] = useState('');
  useEffect(() => {
    const footer = document.querySelector('footer');
    const style = getComputedStyle(footer);
    setMetrics(JSON.stringify({ route: location.pathname + location.search, display: style.display, background: style.backgroundColor, backdropFilter: style.backdropFilter, height: footer.getBoundingClientRect().height, width: footer.getBoundingClientRect().width }));
  }, [location.pathname, location.search]);
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: 24 }}>
    <h1 style={{ fontSize: 22 }}>备案栏真实组件与路由验证</h1>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '18px 0' }}>{paths.map(path => <Link key={path} to={path}>{path}</Link>)}</nav>
    <section style={{ minHeight: 200, padding: 24, background: 'linear-gradient(110deg,#dbeafe 0%,#dbeafe 50%,#ccfbf1 50%,#ccfbf1 100%)', borderRadius: 16 }}>
      <p>当前路由：{location.pathname}{location.search}</p>
      <p style={{ padding: '30px 0' }}>备案栏背景应透明透出浅蓝和浅绿色。</p>
      <SiteRecordFooter className="mt-4 w-full max-w-5xl" />
    </section>
    <pre id="footer-metrics" aria-live="polite" style={{ whiteSpace: 'pre-wrap', paddingTop: 20 }}>{metrics}</pre>
  </main>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/login']}><FooterFixture /></MemoryRouter>);

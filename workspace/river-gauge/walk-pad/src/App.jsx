import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import WalkTab from './components/WalkTab.jsx';
import HistoryView from './components/HistoryView.jsx';
import JumpList from './components/JumpList.jsx';

const TABS = [
  ['walk', '巡测记录'],
  ['history', '历史回看'],
  ['jumps', '跳变清单'],
];

export default function App() {
  const [tab, setTab] = useState('walk');
  const [sketch, setSketch] = useState(null);
  const [walkers, setWalkers] = useState([]);
  const [err, setErr] = useState('');

  const reloadWalkers = useCallback(() => {
    api.walkers().then(setWalkers).catch(() => {});
  }, []);

  useEffect(() => {
    api.sketch().then(setSketch).catch((e) => setErr('接口连不上：' + e.message));
    reloadWalkers();
  }, [reloadWalkers]);

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!sketch) return <div className="page"><p>加载河道简图中…</p></div>;

  return (
    <div className="page">
      <header className="topbar">
        <h1>巡河记录</h1>
        <nav>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'walk' && (
        <WalkTab sketch={sketch} walkers={walkers} onSavedReading={reloadWalkers} />
      )}
      {tab === 'history' && <HistoryView sections={sketch.sections} />}
      {tab === 'jumps' && <JumpList sections={sketch.sections} />}
    </div>
  );
}

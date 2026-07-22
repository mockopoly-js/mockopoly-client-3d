import { createRoot } from 'react-dom/client';

function App() {
  return <div>Mockopoly 3D</div>;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}

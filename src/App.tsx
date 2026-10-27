import * as React from 'react';
import { ToastHost } from '@/components/ui';
import Home from '@/pages/Home';

const PhotoStudio = React.lazy(() => import('@/studios/PhotoStudio'));
const VideoStudio = React.lazy(() => import('@/studios/VideoStudio'));

type Route = 'home' | 'photo' | 'video';

export default function App() {
  const [route, setRoute] = React.useState<Route>(() => {
    const h = location.hash.replace('#', '');
    return h === 'photo' || h === 'video' ? h : 'home';
  });
  React.useEffect(() => {
    const on = () => {
      const h = location.hash.replace('#', '');
      setRoute(h === 'photo' || h === 'video' ? h : 'home');
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route) => {
    location.hash = r === 'home' ? '' : r;
    setRoute(r);
  };
  return (
    <ToastHost>
      <div className="h-full">
        <React.Suspense fallback={<div className="flex h-full items-center justify-center text-dim">Loading…</div>}>
          {route === 'home' && <Home onOpen={go} />}
          {route === 'photo' && <PhotoStudio onExit={() => go('home')} />}
          {route === 'video' && <VideoStudio onExit={() => go('home')} />}
        </React.Suspense>
      </div>
    </ToastHost>
  );
}

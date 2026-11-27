import { lazy, Suspense } from 'react';
import { Shell } from './ui/common';
import { CaptureScreen } from './ui/CaptureScreen';
import { CloudConsent } from './ui/CloudConsent';
import { DetailScreen } from './ui/DetailScreen';
import { HomeScreen } from './ui/HomeScreen';
import { IntroSplash } from './ui/IntroSplash';
import { LibraryScreen } from './ui/LibraryScreen';
import { PracticeScreen } from './ui/PracticeScreen';
import { usePath } from './ui/router';
import { YourAiScreen } from './ui/YourAiScreen';

// Development only: a gallery of every picture and check. Vite drops it from the production build.
const DevGallery = import.meta.env.DEV ? lazy(() => import('./ui/DevGallery')) : null;

function Screen({ path }: { path: string }) {
  const [, section, param] = path.split('/');
  switch (section) {
    case 'capture':
      return <CaptureScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'ai':
      return <YourAiScreen />;
    case 'note':
      return param ? <DetailScreen key={param} id={param} /> : <LibraryScreen />;
    case 'practice':
      return param ? <PracticeScreen key={param} id={param} /> : <HomeScreen />;
    case 'dev':
      return DevGallery ? (
        <Suspense fallback={null}>
          <DevGallery />
        </Suspense>
      ) : (
        <HomeScreen />
      );
    default:
      return <HomeScreen />;
  }
}

export function App() {
  const path = usePath();
  return (
    <>
      <IntroSplash />
      <Shell>
        <Screen path={path} />
        <CloudConsent />
      </Shell>
    </>
  );
}

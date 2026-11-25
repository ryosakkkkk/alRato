import { Shell } from './ui/common';
import { CaptureScreen } from './ui/CaptureScreen';
import { CloudConsent } from './ui/CloudConsent';
import { DetailScreen } from './ui/DetailScreen';
import { HomeScreen } from './ui/HomeScreen';
import { LibraryScreen } from './ui/LibraryScreen';
import { PracticeScreen } from './ui/PracticeScreen';
import { usePath } from './ui/router';
import { YourAiScreen } from './ui/YourAiScreen';

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
    default:
      return <HomeScreen />;
  }
}

export function App() {
  const path = usePath();
  return (
    <Shell>
      <Screen path={path} />
      <CloudConsent />
    </Shell>
  );
}

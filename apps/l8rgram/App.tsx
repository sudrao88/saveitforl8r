import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './screens/LoginScreen';
import { GalleryScreen } from './screens/GalleryScreen';

export default function App() {
  const { authStatus, authError, login, logout } = useAuth();

  if (authStatus === 'linked') {
    return <GalleryScreen onLogout={logout} />;
  }

  return (
    <LoginScreen
      onLogin={login}
      isAuthenticating={authStatus === 'authenticating'}
      error={authError}
    />
  );
}

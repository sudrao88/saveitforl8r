import { btn, text } from '@l8r/shared/design-system';

interface Props {
  onLogin: () => void;
  isAuthenticating: boolean;
  error: string | null;
}

export const LoginScreen = ({ onLogin, isAuthenticating, error }: Props) => (
  <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-8">
    <div className="flex flex-col items-center gap-3">
      <img src="/icon.svg" alt="" className="w-24 h-24" />
      <h1 className={`${text.heading} text-3xl`}>l8rgram</h1>
      <p className={`${text.body} text-center max-w-sm`}>
        Your gallery, auto-organized by your calendar.
      </p>
    </div>

    <button
      type="button"
      onClick={onLogin}
      disabled={isAuthenticating}
      className={`${btn.base} ${btn.primary}`}
    >
      {isAuthenticating ? 'Signing in…' : 'Continue with Google'}
    </button>

    {error && (
      <p className={`${text.body} text-(--color-danger) text-center max-w-sm`}>{error}</p>
    )}

    <p className={`${text.caption} text-center max-w-sm`}>
      We use your Google Calendar (read-only) to label and group your photos by event.
      Photos stay on your device.
    </p>
  </div>
);

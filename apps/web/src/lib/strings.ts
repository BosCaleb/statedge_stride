import type { ApiErrorCode } from '@stride/shared/enums';

// Every user-facing string in the web app, in one dictionary, so that Afrikaans can be added as a
// second dictionary of the same shape without a refactor. Functions build strings with numbers.
// Wording rules: describe what is measured, never judge it as good or bad.

export const en = {
  app: {
    name: 'StatEdge Stride',
    shortName: 'Stride',
    skipToContent: 'Skip to content',
  },
  nav: {
    label: 'Main',
    home: 'Home',
    athletes: 'Athletes',
    guide: 'Guide',
    settings: 'Settings',
  },
  account: {
    menu: 'Account',
    signedInAs: (name: string) => `Signed in as ${name}`,
    themeLabel: 'Appearance',
    themeSystem: 'Match the phone',
    themeLight: 'Light',
    themeDark: 'Dark',
    signOut: 'Sign out',
    unsavedTitle: 'Unsaved changes',
    unsavedBody: (n: number) =>
      `${n} ${n === 1 ? 'change has' : 'changes have'} not reached the server yet. Signing out deletes ${n === 1 ? 'it' : 'them'} from this phone.`,
    signOutAnyway: 'Sign out anyway',
  },
  auth: {
    signInTitle: 'Sign in',
    signInIntro: 'Sign in with the email address your organisation invited.',
    signInButton: 'Sign in',
    signingIn: 'Signing you in…',
    callbackFailed: 'Sign-in did not finish. Please try again.',
    fakeTitle: 'Local sign-in',
    fakeIntro: 'This build signs in as a seeded test person instead of using Entra.',
    fakeAs: (email: string) => `Sign in as ${email}`,
    notEnrolledTitle: 'Not part of an organisation yet',
    notEnrolledBody:
      'Your sign-in worked, but this account has not joined an organisation. Open the invite link your administrator sent you, or ask them for a new one.',
    removedTitle: 'Access removed',
    removedBody:
      'This account was removed from its organisation. Ask your administrator if this is a mistake.',
    adminOnly: 'Only an administrator can open this page.',
    sessionExpired: 'Please sign in again to save your work.',
  },
  invite: {
    title: 'Join your organisation',
    intro: 'Sign in with the email address this invite was sent to.',
  },
  home: {
    title: 'Home',
    greeting: (name: string) => `Hello, ${name}`,
    importClips: 'Import clips',
    deviceCheck: 'Device check',
    recentSessions: 'Recent sessions',
    noSessions: 'No sessions yet. Import a clip to start.',
    prepareOffline: 'Prepare for offline',
    prepareOfflineHint:
      'Downloads the pose model and its runtime (about 25 MB). Best done on Wi-Fi.',
    preparingOffline: (percent: number) => `Downloading… ${percent}%`,
    readyOffline: 'Ready for offline',
    prepareFailed: 'The download did not finish. Try again on a better connection.',
    installIos:
      'To install Stride, tap Share and then Add to Home Screen. Installed, it keeps your offline data safer.',
  },
  athletes: {
    title: 'Athletes',
  },
  outbox: {
    saved: 'Saved',
    saving: (n: number) => `Saving ${n}`,
    offline: (n: number) => `Offline, ${n} waiting`,
    attention: 'Needs attention',
    label: 'Sync status',
  },
  guide: {
    title: 'Capture guide',
    intro: 'Set up the camera side-on, still and level, with the whole athlete in frame.',
  },
  settings: {
    title: 'Settings',
  },
  errors: {
    title: 'Something went wrong',
    body: 'The app hit an unexpected problem. Reloading usually fixes it.',
    reload: 'Reload',
    copySupportCode: 'Copy a support code',
    supportCodeCopied: 'Support code copied',
    notFoundTitle: 'Page not found',
    notFoundBody: 'This page does not exist.',
    goHome: 'Go to Home',
    tryAgain: 'Try again',
    offline: 'You are offline. This needs a connection.',
    loading: 'Loading…',
    api: {
      unauthorised: 'Please sign in again.',
      not_enrolled: 'This account has not joined an organisation.',
      forbidden: 'You are not allowed to do this.',
      validation: 'Some details are not valid.',
      not_found: 'Not found.',
      conflict: 'This was already saved with different details.',
      consent_required: 'Consent is needed first.',
      gate_failed: 'This result did not pass the quality checks, so it cannot be saved.',
      seat_limit: 'Your organisation has no free coach seats.',
      payload_too_large: 'This is too large to send.',
      rate_limited: 'Too many requests. Wait a moment and try again.',
      internal: 'The server had a problem. Try again later.',
    } satisfies Record<ApiErrorCode, string>,
  },
  update: {
    available: 'New version available',
    reload: 'Reload',
    later: 'Later',
    waitingForJob: 'A new version is ready. It will load after the analysis finishes.',
  },
  capabilities: {
    title: 'This browser is missing features',
    intro: 'Stride needs these to analyse clips on this phone:',
    workers: 'Web Workers',
    webCodecs: 'WebCodecs (a slower decoder will be used instead)',
    gpu: 'WebGL2 or WebGPU',
    opfs: 'Private file storage (OPFS)',
    compression: 'Compression streams',
    wakeLock: 'Keeping the screen awake (Screen Wake Lock)',
    dismiss: 'Continue',
    unsupported: 'Use a current version of Chrome on Android or Safari on iPhone.',
  },
  common: {
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    back: 'Back',
    retry: 'Retry',
  },
} as const;

export type Strings = typeof en;

/** The active dictionary. A language switch will choose between dictionaries of this shape. */
export const strings: Strings = en;

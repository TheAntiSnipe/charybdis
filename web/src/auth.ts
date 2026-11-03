import {
  AuthenticationDetails,
  CognitoAccessToken,
  CognitoIdToken,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config } from './config';

const pool = new CognitoUserPool({
  UserPoolId: config.userPoolId,
  ClientId: config.userPoolClientId,
});

/** Stores tokens obtained outside the library (passkey sign-in) in the format it reads back. */
export function adoptTokens(tokens: { IdToken: string; AccessToken: string; RefreshToken?: string }): void {
  const idToken = new CognitoIdToken({ IdToken: tokens.IdToken });
  const user = new CognitoUser({ Username: idToken.payload['cognito:username'], Pool: pool });
  user.setSignInUserSession(
    new CognitoUserSession({
      IdToken: idToken,
      AccessToken: new CognitoAccessToken({ AccessToken: tokens.AccessToken }),
      RefreshToken: new CognitoRefreshToken({ RefreshToken: tokens.RefreshToken ?? '' }),
    }),
  );
}

export type SignInResult =
  | { status: 'signed-in' }
  | { status: 'new-password-required'; complete: (newPassword: string) => Promise<void> };

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  const details = new AuthenticationDetails({ Username: email, Password: password });

  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: () => resolve({ status: 'signed-in' }),
      onFailure: reject,
      newPasswordRequired: (attributes: Record<string, string>) => {
        // These are immutable/read-only and must not be sent back with the challenge response.
        delete attributes.email;
        delete attributes.email_verified;
        resolve({
          status: 'new-password-required',
          complete: (newPassword) =>
            new Promise<void>((done, fail) => {
              user.completeNewPasswordChallenge(newPassword, attributes, {
                onSuccess: () => done(),
                onFailure: fail,
              });
            }),
        });
      },
    });
  });
}

export type SessionState =
  | { status: 'valid'; session: CognitoUserSession }
  | { status: 'none' }
  | { status: 'unreachable' };

/**
 * Refreshes tokens silently when needed. Only a rejected refresh token means "signed out";
 * a network failure must never log the user out.
 */
export function resolveSession(): Promise<SessionState> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve({ status: 'none' });
  return new Promise((resolve) => {
    user.getSession((err: (Error & { code?: string }) | null, session: CognitoUserSession | null) => {
      if (session?.isValid()) resolve({ status: 'valid', session });
      else if (err?.code === 'NetworkError') resolve({ status: 'unreachable' });
      else resolve({ status: 'none' });
    });
  });
}

export async function getSession(): Promise<CognitoUserSession | null> {
  const state = await resolveSession();
  return state.status === 'valid' ? state.session : null;
}

/** Revokes the refresh token server-side (best effort), then always clears local tokens. */
export function signOut(): Promise<void> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      user.signOut();
      resolve();
    };
    user.signOut(finish);
    setTimeout(finish, 3000);
  });
}

export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'Incorrect email or password.';
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Too many attempts. Wait a minute and try again.';
    case 'NetworkError':
      return 'Network problem. Check your connection.';
    default:
      return e.message || 'Something went wrong.';
  }
}

import { adoptTokens, getSession } from './auth';
import { config } from './config';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class CognitoError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** Passkeys only work on the domain the user pool is bound to, in a browser that supports WebAuthn. */
export function passkeysAvailable(): boolean {
  return !!window.PublicKeyCredential && location.hostname === config.passkeyRpId;
}

// Cognito's JSON protocol; these operations authenticate with the tokens in the body, so no SigV4 is needed.
async function cognito(target: string, body: Json): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CognitoError('Network problem. Check your connection.', 'NetworkError');
  }
  const json = await res.json();
  if (!res.ok) throw new CognitoError(json.message ?? 'Request failed', String(json.__type ?? '').split('#').pop() ?? '');
  return json;
}

const toBytes = (b64url: string): Uint8Array => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

const toB64Url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeDescriptors = (list?: Json[]) => list?.map((d) => ({ ...d, id: toBytes(d.id) }));

// Prefer the browser's own serializer; fall back for older Safari versions.
function credentialToJson(credential: PublicKeyCredential): Json {
  const native = (credential as unknown as { toJSON?: () => Json }).toJSON;
  if (native) return native.call(credential);

  const r = credential.response as Json;
  const response: Json = { clientDataJSON: toB64Url(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = toB64Url(r.attestationObject);
    response.transports = r.getTransports?.() ?? [];
  } else {
    response.authenticatorData = toB64Url(r.authenticatorData);
    response.signature = toB64Url(r.signature);
    if (r.userHandle) response.userHandle = toB64Url(r.userHandle);
  }
  return {
    id: credential.id,
    rawId: toB64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response,
  };
}

async function runCeremony<T>(action: () => Promise<T | null>): Promise<T> {
  try {
    const result = await action();
    if (!result) throw new CognitoError('No passkey was provided.', 'PasskeyCancelled');
    return result;
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw new CognitoError('Passkey request was cancelled or timed out.', 'PasskeyCancelled');
    }
    throw err;
  }
}

export async function signInWithPasskey(email: string): Promise<void> {
  const init = await cognito('InitiateAuth', {
    AuthFlow: 'USER_AUTH',
    ClientId: config.userPoolClientId,
    AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: 'WEB_AUTHN' },
  });
  if (init.ChallengeName !== 'WEB_AUTHN') {
    throw new CognitoError('No passkey is set up for this account yet. Sign in with your password, then add one.', 'NoPasskey');
  }

  const options = JSON.parse(init.ChallengeParameters.CREDENTIAL_REQUEST_OPTIONS);
  const credential = await runCeremony(() =>
    navigator.credentials.get({
      publicKey: { ...options, challenge: toBytes(options.challenge), allowCredentials: decodeDescriptors(options.allowCredentials) },
    }) as Promise<PublicKeyCredential | null>,
  );

  const done = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'WEB_AUTHN',
    ClientId: config.userPoolClientId,
    Session: init.Session,
    ChallengeResponses: { USERNAME: email, CREDENTIAL: JSON.stringify(credentialToJson(credential)) },
  });
  if (!done.AuthenticationResult) throw new CognitoError('Passkey sign-in failed.', 'PasskeyFailed');
  adoptTokens(done.AuthenticationResult);
}

/** Registers a passkey for the signed-in user (iCloud Keychain on iPhone prompts for Face ID). */
export async function registerPasskey(): Promise<void> {
  const session = await getSession();
  if (!session) throw new CognitoError('Not signed in', 'NotAuthorizedException');
  const accessToken = session.getAccessToken().getJwtToken();

  const { CredentialCreationOptions: options } = await cognito('StartWebAuthnRegistration', { AccessToken: accessToken });
  const credential = await runCeremony(() =>
    navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        user: { ...options.user, id: toBytes(options.user.id) },
        excludeCredentials: decodeDescriptors(options.excludeCredentials),
      },
    }) as Promise<PublicKeyCredential | null>,
  );

  await cognito('CompleteWebAuthnRegistration', { AccessToken: accessToken, Credential: credentialToJson(credential) });
}

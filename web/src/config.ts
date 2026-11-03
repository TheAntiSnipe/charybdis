// Deployment-specific values come from web/.env.local (gitignored); see web/.env.example.
function required(name: string): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`Missing ${name}; copy web/.env.example to web/.env.local and fill it in.`);
  return value;
}

export const config = {
  region: required('VITE_AWS_REGION'),
  userPoolId: required('VITE_USER_POOL_ID'),
  userPoolClientId: required('VITE_USER_POOL_CLIENT_ID'),
  passkeyRpId: required('VITE_PASSKEY_RP_ID'),
} as const;

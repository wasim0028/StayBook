import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserNotFoundException,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

export interface DirectoryUser {
  userId: string;
  email: string | null;
  name: string | null;
  enabled: boolean;
  status: string;
  createdAt: string | null;
  groups?: string[];
}

/** Cognito, behind an interface so tests don't need it. */
export interface Directory {
  findByEmailPrefix(prefix: string, limit: number): Promise<DirectoryUser[]>;
  get(userId: string): Promise<DirectoryUser | null>;
  /** Disabling also signs the user out everywhere (revokes refresh tokens). */
  setEnabled(userId: string, enabled: boolean): Promise<void>;
}

const attr = (a: AttributeType[] | undefined, n: string) => a?.find((x) => x.Name === n)?.Value ?? null;

export function cognitoDirectory(userPoolId: string, client = new CognitoIdentityProviderClient({})): Directory {
  return {
    async findByEmailPrefix(prefix, limit) {
      // Cognito filter syntax: quotes must be escaped; the caller has already validated the characters.
      const r = await client.send(new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email ^= "${prefix.replace(/"/g, "")}"`, Limit: limit }));
      return (r.Users ?? []).map((u) => ({
        userId: attr(u.Attributes, "sub") ?? u.Username ?? "",
        email: attr(u.Attributes, "email"),
        name: attr(u.Attributes, "name"),
        enabled: u.Enabled ?? false,
        status: u.UserStatus ?? "UNKNOWN",
        createdAt: u.UserCreateDate?.toISOString() ?? null,
      }));
    },
    async get(userId) {
      try {
        const [u, g] = await Promise.all([
          client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userId })),
          client.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: userId })),
        ]);
        return {
          userId,
          email: attr(u.UserAttributes, "email"),
          name: attr(u.UserAttributes, "name"),
          enabled: u.Enabled ?? false,
          status: u.UserStatus ?? "UNKNOWN",
          createdAt: u.UserCreateDate?.toISOString() ?? null,
          groups: (g.Groups ?? []).map((x) => x.GroupName ?? "").filter(Boolean),
        };
      } catch (e) {
        if (e instanceof UserNotFoundException) return null;
        throw e;
      }
    },
    async setEnabled(userId, enabled) {
      if (enabled) {
        await client.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: userId }));
      } else {
        await client.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: userId }));
        await client.send(new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: userId }));
      }
    },
  };
}

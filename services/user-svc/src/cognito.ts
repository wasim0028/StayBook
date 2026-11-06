import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

export interface GroupAdmin {
  addToGroup(userId: string, group: "host"): Promise<void>;
}

/** The pool signs in by email, so Cognito's generated username is the user's `sub`. */
export function cognitoGroups(userPoolId: string, client = new CognitoIdentityProviderClient({})): GroupAdmin {
  return {
    async addToGroup(userId, group) {
      await client.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: userId, GroupName: group }));
    },
  };
}

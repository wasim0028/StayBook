import { Redirect } from "expo-router";

// Deep-link target for the Cognito hosted UI. expo-auth-session captures the
// result itself; this route only stops the router from showing "unmatched route".
export default function AuthRedirect() {
  return <Redirect href="/" />;
}

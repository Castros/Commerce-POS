import { LoginClient } from "../login/LoginClient";

export default function RegisterLoginPage() {
  return <LoginClient nextPath="/register" cashierMode />;
}

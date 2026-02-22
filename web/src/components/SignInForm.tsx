import { SignIn } from "@clerk/clerk-react";

export function SignInForm() {
  return (
    <div className="card" style={{ display: "flex", justifyContent: "center" }}>
      <SignIn routing="hash" />
    </div>
  );
}

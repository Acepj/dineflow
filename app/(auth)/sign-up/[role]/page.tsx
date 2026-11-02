import { redirect } from "next/navigation";
import SignUpForm from "@/components/auth/sign-up-form";
import { Role, roles, canSelfSignup } from "@/lib/auth/role";

export default async function SignUpRolePage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  const parsedRole = role as Role;

  if (!roles.some((item) => item.id === parsedRole)) {
    redirect("/sign-up");
  }

  // Staff and admin accounts are provisioned by an administrator — they can
  // only sign in, so send anyone trying to self-register to the sign-in page.
  if (!canSelfSignup(parsedRole)) {
    redirect(`/sign-in/${parsedRole}`);
  }

  return <SignUpForm role={parsedRole} />;
}

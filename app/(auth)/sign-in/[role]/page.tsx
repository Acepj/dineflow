import SignInForm from "@/components/auth/sign-in-form";
import { Role, roles } from "@/lib/auth/role";
import { redirect } from "next/navigation";

export default async function SignInRolePage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  const parsedRole = role as Role;
  if (!roles.some((item) => item.id === parsedRole)) {
    redirect("/sign-in");
  }
  return <SignInForm role={parsedRole} />;
}

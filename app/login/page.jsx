import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Log in",
};

export default async function LoginPage({ searchParams }) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  const params = (await searchParams) ?? {};
  const initialTab = params.mode === "register" ? "register" : "login";

  return (
    <section className="hero">
      <h1>
        Make any link <em>deeply suspicious.</em>
      </h1>
      <p className="lede">
        Log in to manage your saved links. All your custom URLs are tied to
        your private account key so only you can view or edit them.
      </p>
      <AuthForm initialTab={initialTab} />
    </section>
  );
}

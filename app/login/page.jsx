import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Log in · Sus URL Shortener",
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
        Enter the <em>sus headquarters.</em>
      </h1>
      <p className="lede">
        Log in to manage your link collection. Every link you create is filed
        under your own secret owner key — nobody else can see or touch them.
      </p>
      <AuthForm initialTab={initialTab} />
    </section>
  );
}

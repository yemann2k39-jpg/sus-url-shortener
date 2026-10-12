import CreateForm from "@/components/CreateForm";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <section className="hero">
      <h1>
        Make any link <em>deeply suspicious.</em>
      </h1>
      <p className="lede">
        Turn harmless links into digital red flags. Watch your friends
        double-check before they dare to click.
      </p>

      {user ? (
        <CreateForm />
      ) : (
        <div className="card auth-card">
          <p className="placeholder-title">Account required to create links.</p>
          <p className="placeholder-note">
            <a href="/login">Log in</a> or{" "}
            <a href="/login?mode=register">register</a> in seconds. Your links
            remain private to your account.
          </p>
        </div>
      )}
    </section>
  );
}

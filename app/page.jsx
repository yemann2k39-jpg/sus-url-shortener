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
        Paste a legitimate URL. Get back a link with a name that inspires
        absolutely no confidence. It still goes to the real site &mdash; the
        vibe is the only thing that changes.
      </p>

      {user ? (
        <CreateForm />
      ) : (
        <div className="card auth-card">
          <p className="placeholder-title">Link creation is for members.</p>
          <p className="placeholder-note">
            <a href="/login">Log in or register</a> — it takes twenty seconds
            and your links stay yours alone.
          </p>
        </div>
      )}
    </section>
  );
}

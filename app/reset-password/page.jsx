import { Suspense } from "react";
import ResetForm from "@/components/ResetForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return (
    <section className="hero">
      <h1>
        Pick something <em>less guessable.</em>
      </h1>
      <p className="lede">
        Choose a new password for your account. Reset links are single-use and
        expire after an hour; completing a reset signs out every session on
        the account.
      </p>
      <div className="card auth-card">
        <Suspense fallback={<p className="placeholder-note">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </section>
  );
}

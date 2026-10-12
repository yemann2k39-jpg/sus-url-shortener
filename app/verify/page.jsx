import ResendForm from "@/components/ResendForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify your email",
};

export default async function VerifyPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const status = params.status === "ok" ? "ok" : params.status === "invalid" ? "invalid" : null;
  const email = typeof params.email === "string" ? params.email : "";

  return (
    <section className="hero">
      <h1>
        One more <em>click of trust.</em>
      </h1>

      {status === "ok" ? (
        <div className="card auth-card">
          <p className="placeholder-title">Email verified. You&rsquo;re in.</p>
          <p className="placeholder-note">
            Your account is fully armed — head to your{" "}
            <a href="/dashboard">dashboard</a> and make something suspicious.
          </p>
        </div>
      ) : status === "invalid" ? (
        <div className="card auth-card">
          <p className="placeholder-title">That link didn&rsquo;t work.</p>
          <p className="placeholder-note">
            Verification links expire after 24 hours and can only be used once.
            Enter your email below and we&rsquo;ll send a fresh one.
          </p>
          <ResendForm initialEmail={email} />
        </div>
      ) : (
        <div className="card auth-card">
          <p className="placeholder-title">Waiting on your verification link?</p>
          <p className="placeholder-note">
            Enter the email you registered with and we&rsquo;ll send a fresh
            verification link. Didn&rsquo;t get it? Check spam — the sender is
            suspiciously legitimate.
          </p>
          <ResendForm initialEmail={email} />
        </div>
      )}
    </section>
  );
}

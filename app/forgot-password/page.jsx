import ForgotForm from "@/components/ForgotForm";

export const metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    <section className="hero">
      <h1>
        Locked out? <em>Not very sus of you.</em>
      </h1>
      <p className="lede">
        Enter the email on your account and we&rsquo;ll send a one-time reset
        link. It expires in an hour — reset links are single-use, and
        completing one signs out every session on the account.
      </p>
      <div className="card auth-card">
        <ForgotForm />
      </div>
    </section>
  );
}

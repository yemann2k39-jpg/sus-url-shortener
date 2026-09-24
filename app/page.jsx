import CreateForm from "@/components/CreateForm";

export default function HomePage() {
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

      <CreateForm />
    </section>
  );
}

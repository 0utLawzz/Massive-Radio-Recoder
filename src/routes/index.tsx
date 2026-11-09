import { createFileRoute } from "@tanstack/react-router";
import { Deck } from "@/components/deck";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <Deck />
    </main>
  );
}

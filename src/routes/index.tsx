import { createFileRoute } from "@tanstack/react-router";
import { Deck } from "@/components/deck";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col px-3 py-4 sm:px-6 sm:py-8"
      suppressHydrationWarning
    >
      <Deck />
    </main>
  );
}


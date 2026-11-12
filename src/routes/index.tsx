import { createFileRoute } from "@tanstack/react-router";
import { Deck } from "@/components/deck";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col px-2 py-3 sm:px-6 sm:py-6"
      suppressHydrationWarning
    >
      <Deck />
    </main>
  );
}


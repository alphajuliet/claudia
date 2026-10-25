import { useQuery } from "@tanstack/react-query";
import { HealthSchema } from "@claudia/shared";

export function App() {
  const { data, error } = useQuery({
    queryKey: ["health"],
    queryFn: async () => HealthSchema.parse(await (await fetch("/api/health")).json()),
  });

  return (
    <main>
      <h1>Claudia</h1>
      <p>{error ? "API unreachable" : data ? "API ok" : "Checking API…"}</p>
    </main>
  );
}

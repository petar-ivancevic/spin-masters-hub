import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Printer, Swords, FileSpreadsheet } from "lucide-react";
import { Link } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

type BeyWithAbbrev = {
  name: string;
  abbrev: string;
};

type InventoryEntry = {
  player_id: string;
  beyblades:
    | {
        id: string;
        name: string;
        product_code: string | null;
      }
    | {
        id: string;
        name: string;
        product_code: string | null;
      }[]
    | null;
};

type InventoryBey = {
    id: string;
    name: string;
    product_code: string | null;
};

/** Generate kid-friendly abbreviation: prefer product code, else short form */
function getAbbrev(name: string, productCode: string | null, used: Set<string>): string {
  if (productCode && /^[A-Z]{2}-\d+$/.test(productCode)) {
    const candidate = productCode.toUpperCase();
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Short form: first 4–5 chars of first word + first char of next if it's a letter
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.slice(0, 5) ?? name.slice(0, 5);
  const second = parts[1];
  let candidate = first;
  if (second && /^[a-zA-Z]/.test(second)) {
    candidate = first + second[0];
  }
  candidate = candidate.slice(0, 6);
  let i = 0;
  let final = candidate;
  while (used.has(final) && i < 10) {
    final = candidate + (i > 0 ? String(i) : "");
    i++;
  }
  used.add(final);
  return final;
}

export default function BattleLogForm() {
  const [stevanBeys, setStevanBeys] = useState<BeyWithAbbrev[]>([]);
  const [maxBeys, setMaxBeys] = useState<BeyWithAbbrev[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError("Not connected to the app. Add your beys in Inventory first, then try again.");
      setIsLoading(false);
      return;
    }

    const loadInventories = async () => {
      setIsLoading(true);
      setError(null);

      const { data: players } = await supabase
        .from("players")
        .select("id, display_name")
        .in("display_name", ["Stevan", "Max"]);

      const stevan = players?.find((p) => p.display_name === "Stevan");
      const max = players?.find((p) => p.display_name === "Max");

      if (!stevan || !max) {
        setError("Stevan and Max need to be added as players first. Go to Inventory to add them!");
        setStevanBeys([]);
        setMaxBeys([]);
        setIsLoading(false);
        return;
      }

      const { data: inventory } = await supabase
        .from("player_beyblades")
        .select("player_id, beyblades(id, name, product_code)")
        .in("player_id", [stevan.id, max.id]);

      const abbrevUsed = new Set<string>();
      const stevanList: BeyWithAbbrev[] = [];
      const maxList: BeyWithAbbrev[] = [];

      const inventoryRows = (inventory ?? []) as InventoryEntry[];
      inventoryRows.forEach((entry) => {
        const bey = Array.isArray(entry.beyblades) ? entry.beyblades[0] : entry.beyblades;
        if (!bey?.name) return;
        const normalizedBey = bey as InventoryBey;
        const abbrev = getAbbrev(normalizedBey.name, normalizedBey.product_code ?? null, abbrevUsed);
        const item = { name: bey.name, abbrev };
        if (entry.player_id === stevan.id) {
          stevanList.push(item);
        } else if (entry.player_id === max.id) {
          maxList.push(item);
        }
      });

      stevanList.sort((a, b) => a.name.localeCompare(b.name));
      maxList.sort((a, b) => a.name.localeCompare(b.name));
      setStevanBeys(stevanList);
      setMaxBeys(maxList);
      setIsLoading(false);
    };

    loadInventories();
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const BATTLE_ROWS = 12;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white text-black">
        <Navbar />
        <div className="pt-24 pb-12 px-4">
          <div className="container mx-auto text-center text-lg text-muted-foreground">
            Loading your beys...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <Navbar />
      <main className="pt-24 pb-12 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Screen-only: header and actions */}
          <div className="mb-6 print:hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-1">
                Battle Log Form
              </h1>
              <p className="text-muted-foreground">
                Print this form to log battles offline, then import later
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handlePrint} size="lg">
                <Printer className="w-4 h-4 mr-2" />
                Print Form
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/csv-editor">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import Battles
                </Link>
              </Button>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-destructive/20 border border-destructive/40 text-foreground print:hidden">
              <p className="font-medium">{error}</p>
              <Link to="/inventory" className="text-primary underline mt-2 inline-block">
                Go to Inventory →
              </Link>
            </div>
          )}

          {/* Printable form */}
          <div className="bg-white border border-gray-300 rounded-xl p-6 md:p-8 shadow-sm print:shadow-none print:border print:rounded">
            {/* Title - kid friendly */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-3">
                <Swords className="w-8 h-8 text-black" />
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold text-black">
                Let it rip! Battle Log
              </h2>
              <p className="text-gray-700 mt-1 text-lg">
                Stevan vs Max
              </p>
            </div>

            {/* Instructions */}
            <div className="mb-6 p-4 rounded-lg bg-gray-50 border border-gray-300">
              <h3 className="font-display font-semibold text-black mb-2 text-lg">
                How to use this form
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-black text-base">
                <li>Use the abbreviations below when writing which bey you used.</li>
                <li>Fill in the score after each battle (best of 3 or 5).</li>
                <li>When you get home, go to <strong>CSV Editor</strong> and type in your battles.</li>
                <li>Use the <strong>full bey name</strong> when typing into the computer (check the legend!).</li>
              </ol>
            </div>

            {/* Legend: Bey abbreviations */}
            <div className="mb-8">
              <h3 className="font-display font-semibold text-black mb-3 text-lg flex items-center gap-2">
                <span>Legend – quick abbreviations</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-300 p-4 bg-white">
                  <h4 className="font-display font-bold text-black mb-2 text-base">
                    Stevan&apos;s beys
                  </h4>
                  {stevanBeys.length === 0 ? (
                    <p className="text-muted-foreground text-sm italic">
                      (Add beys in Inventory first)
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {stevanBeys.map((b) => (
                        <li key={b.name} className="flex gap-2 items-baseline">
                          <span className="font-mono font-bold text-black min-w-[3rem]">
                            {b.abbrev}
                          </span>
                          <span className="text-black">= {b.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-gray-300 p-4 bg-white">
                  <h4 className="font-display font-bold text-black mb-2 text-base">
                    Max&apos;s beys
                  </h4>
                  {maxBeys.length === 0 ? (
                    <p className="text-muted-foreground text-sm italic">
                      (Add beys in Inventory first)
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {maxBeys.map((b) => (
                        <li key={b.name} className="flex gap-2 items-baseline">
                          <span className="font-mono font-bold text-black min-w-[3rem]">
                            {b.abbrev}
                          </span>
                          <span className="text-black">= {b.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Battle log table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-base">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="text-left py-2 px-2 font-display font-semibold text-black w-8">
                      #
                    </th>
                    <th className="text-left py-2 px-2 font-display font-semibold text-black min-w-[5rem]">
                      Date
                    </th>
                    <th className="text-left py-2 px-2 font-display font-semibold text-black">
                      Stevan&apos;s bey
                    </th>
                    <th className="text-center py-2 px-2 font-display font-semibold text-black w-14">
                      S
                    </th>
                    <th className="text-left py-2 px-2 font-display font-semibold text-black">
                      Max&apos;s bey
                    </th>
                    <th className="text-center py-2 px-2 font-display font-semibold text-black w-14">
                      M
                    </th>
                    <th className="text-left py-2 px-2 font-display font-semibold text-black min-w-[4rem]">
                      Winner
                    </th>
                    <th className="text-center py-2 px-2 font-display font-semibold text-muted-foreground w-12">
                      B
                    </th>
                    <th className="text-center py-2 px-2 font-display font-semibold text-muted-foreground w-12">
                      KO
                    </th>
                    <th className="text-center py-2 px-2 font-display font-semibold text-muted-foreground w-14">
                      Spin
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: BATTLE_ROWS }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-300">
                      <td className="py-3 px-2 text-gray-700">{i + 1}</td>
                      <td className="py-3 px-2">
                        <span className="inline-block min-h-[1.5rem] w-full border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-block min-h-[1.5rem] w-full border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-block min-h-[1.5rem] w-8 border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-block min-h-[1.5rem] w-full border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-block min-h-[1.5rem] w-8 border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-block min-h-[1.5rem] w-full border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-block min-h-[1.5rem] w-6 border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-block min-h-[1.5rem] w-6 border-b border-dashed border-muted-foreground/40" />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-block min-h-[1.5rem] w-8 border-b border-dashed border-muted-foreground/40" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-700 mt-4">
              S = Stevan&apos;s score · M = Max&apos;s score · B = Bursts · KO = Knockouts · Spin = Spin finishes
            </p>
          </div>
        </div>
      </main>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body, main, .container, table, th, td, p, h1, h2, h3, h4, span { color: #000 !important; }
          body, main, .container, div, table, thead, tbody, tr, th, td { background: #fff !important; }
          nav { display: none !important; }
          .print\\:hidden { display: none !important; }
          main { padding-top: 0 !important; }
        }
      `}</style>
    </div>
  );
}
